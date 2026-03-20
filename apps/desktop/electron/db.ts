import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function initDB() {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'queueflow.db');
  db = new Database(dbPath);

  // WAL mode for crash safety — survives power failures
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Tickets (mirror of cloud tickets table)
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      office_id TEXT NOT NULL,
      department_id TEXT,
      service_id TEXT,
      desk_id TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      priority INTEGER DEFAULT 0,
      customer_data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      called_at TEXT,
      called_by_staff_id TEXT,
      serving_started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      parked_at TEXT,
      recall_count INTEGER DEFAULT 0,
      notes TEXT,
      is_remote INTEGER DEFAULT 0,
      is_offline INTEGER DEFAULT 0,
      appointment_id TEXT,
      synced_at TEXT
    );

    -- Offices cache
    CREATE TABLE IF NOT EXISTS offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      organization_id TEXT,
      settings TEXT DEFAULT '{}',
      operating_hours TEXT DEFAULT '{}',
      updated_at TEXT
    );

    -- Departments cache
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      office_id TEXT,
      updated_at TEXT
    );

    -- Services cache
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      estimated_service_time INTEGER DEFAULT 10,
      updated_at TEXT
    );

    -- Desks cache
    CREATE TABLE IF NOT EXISTS desks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      office_id TEXT,
      is_active INTEGER DEFAULT 1,
      current_staff_id TEXT,
      updated_at TEXT
    );

    -- Staff cache
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      full_name TEXT,
      email TEXT,
      role TEXT,
      office_id TEXT,
      department_id TEXT,
      updated_at TEXT
    );

    -- Sync queue for offline mutations
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      synced_at TEXT
    );

    -- Session storage
    CREATE TABLE IF NOT EXISTS session (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Ticket number counter (for offline ticket generation)
    CREATE TABLE IF NOT EXISTS ticket_counter (
      office_id TEXT NOT NULL,
      dept_code TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      date TEXT NOT NULL,
      PRIMARY KEY (office_id, dept_code, date)
    );

    -- Local audit trail for every ticket activity (survives crashes, never deleted)
    CREATE TABLE IF NOT EXISTS ticket_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      ticket_number TEXT,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      source TEXT DEFAULT 'station',
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_ticket ON ticket_audit_log(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_audit_log_created ON ticket_audit_log(created_at);

    -- Office holidays/closures cache
    CREATE TABLE IF NOT EXISTS office_holidays (
      id TEXT PRIMARY KEY,
      office_id TEXT NOT NULL,
      holiday_date TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Holiday',
      is_full_day INTEGER DEFAULT 1,
      open_time TEXT,
      close_time TEXT
    );

    -- Indexes (only on columns guaranteed to exist in CREATE TABLE above)
    CREATE INDEX IF NOT EXISTS idx_office_holidays_lookup ON office_holidays(office_id, holiday_date);
    CREATE INDEX IF NOT EXISTS idx_tickets_office_status ON tickets(office_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_dept ON tickets(department_id, status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
  `);

  // ── Safe schema migrations (idempotent) ──
  // Each ALTER TABLE is wrapped in try/catch — if the column already exists, it silently skips.
  try { db.exec(`ALTER TABLE offices ADD COLUMN timezone TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE offices ADD COLUMN operating_hours TEXT DEFAULT '{}'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN is_offline INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN parked_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN recall_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN is_remote INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN appointment_id TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN synced_at TEXT`); } catch { /* already exists */ }

  // Indexes that depend on migrated columns (must come after ALTER TABLEs)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_retry ON sync_queue(next_retry_at) WHERE synced_at IS NULL AND next_retry_at IS NOT NULL`); } catch { /* */ }

  // ── Integrity check on startup — detect corruption early ──
  try {
    const integrity = db.pragma('integrity_check') as any[];
    if (integrity?.[0]?.integrity_check !== 'ok') {
      console.error('[db] INTEGRITY CHECK FAILED:', integrity);
    }
  } catch (err) {
    console.error('[db] Could not run integrity check:', err);
  }

  // ── One-time cleanup: remove L- prefixed local tickets that have a cloud equivalent ──
  const lCleanup = db.prepare(`
    DELETE FROM tickets WHERE ticket_number LIKE 'L-%' AND id IN (
      SELECT t1.id FROM tickets t1
      INNER JOIN tickets t2 ON t1.office_id = t2.office_id
        AND ('L-' || t2.ticket_number) = t1.ticket_number
        AND t1.id != t2.id
      WHERE t1.ticket_number LIKE 'L-%' AND t2.ticket_number NOT LIKE 'L-%'
    )
  `).run();
  if (lCleanup.changes > 0) {
    console.log(`[db] Cleaned up ${lCleanup.changes} L-prefixed duplicate ticket rows`);
  }

  return db;
}

export function getDB(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ── Ticket audit log — immutable trail of every ticket lifecycle event ──
// Never deleted, survives crashes. Used for debugging, compliance, and support.
export function logTicketEvent(
  ticketId: string,
  eventType: string,
  opts?: {
    ticketNumber?: string;
    fromStatus?: string;
    toStatus?: string;
    source?: string;
    details?: Record<string, unknown>;
  }
) {
  try {
    db.prepare(`
      INSERT INTO ticket_audit_log (ticket_id, ticket_number, event_type, from_status, to_status, source, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketId,
      opts?.ticketNumber ?? null,
      eventType,
      opts?.fromStatus ?? null,
      opts?.toStatus ?? null,
      opts?.source ?? 'station',
      JSON.stringify(opts?.details ?? {}),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[audit] Failed to log ticket event:', err);
  }
}

// ── Timezone-aware local date ──────────────────────────────────────
// Returns YYYY-MM-DD in the office's configured timezone (falls back to system local)
export function getLocalDate(officeId?: string, dbInstance?: Database.Database): string {
  const d = dbInstance ?? db;
  if (officeId) {
    const office = d.prepare('SELECT timezone FROM offices WHERE id = ?').get(officeId) as any;
    if (office?.timezone) {
      return new Date().toLocaleDateString('en-CA', { timeZone: office.timezone }); // YYYY-MM-DD
    }
  }
  // Fallback: system local date (NOT UTC)
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// Generate offline ticket number: L-{DEPT_CODE}-{COUNTER}
// Counter resets daily in the office's local timezone
export function generateOfflineTicketNumber(officeId: string, deptCode: string, dbInstance?: Database.Database): string {
  const d = dbInstance ?? db;
  const today = getLocalDate(officeId, d);

  const row = d.prepare(`
    INSERT INTO ticket_counter (office_id, dept_code, counter, date)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (office_id, dept_code, date)
    DO UPDATE SET counter = counter + 1
    RETURNING counter
  `).get(officeId, deptCode, today) as any;

  const num = String(row.counter).padStart(3, '0');
  return `L-${deptCode}-${num}`;
}
