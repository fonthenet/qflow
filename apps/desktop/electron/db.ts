import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

let db: Database.Database;

export function initDB() {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'qflo.db');
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
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('issued','pending_approval','waiting','called','serving','served','cancelled','no_show','transferred','parked')),
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
      synced_at TEXT,
      source TEXT DEFAULT 'local_kiosk',
      daily_sequence INTEGER DEFAULT 0,
      priority_category_id TEXT
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
      display_name TEXT,
      department_id TEXT,
      office_id TEXT,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','paused','break')),
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
      synced_at TEXT,
      already_notified INTEGER DEFAULT 0
    );

    -- Session storage
    CREATE TABLE IF NOT EXISTS session (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      station_token TEXT
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

    -- Broadcast message templates (local-only, no cloud sync needed)
    CREATE TABLE IF NOT EXISTS broadcast_templates (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL,
      shortcut TEXT,
      body_fr TEXT,
      body_ar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes (only on columns guaranteed to exist in CREATE TABLE above)
    CREATE INDEX IF NOT EXISTS idx_broadcast_templates_org ON broadcast_templates(organization_id);
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
  try { db.exec(`ALTER TABLE sync_queue ADD COLUMN already_notified INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN is_offline INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN parked_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN recall_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN is_remote INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN appointment_id TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN synced_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN source TEXT DEFAULT 'walk_in'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN daily_sequence INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN priority_category_id TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN locale TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE desks ADD COLUMN status TEXT DEFAULT 'open'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE desks ADD COLUMN display_name TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE session ADD COLUMN station_token TEXT`); } catch { /* already exists */ }

  // ── CHECK constraint enforcement via triggers (for existing DBs without inline CHECKs) ──
  // SQLite cannot ALTER TABLE to add CHECK constraints, so we use BEFORE triggers.
  const VALID_TICKET_STATUSES = `('issued','pending_approval','waiting','called','serving','served','cancelled','no_show','transferred','parked')`;
  const VALID_DESK_STATUSES = `('open','closed','paused','break')`;
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_tickets_status_check_insert
      BEFORE INSERT ON tickets
      WHEN NEW.status NOT IN ${VALID_TICKET_STATUSES}
      BEGIN
        SELECT RAISE(ABORT, 'Invalid ticket status');
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_tickets_status_check_update
      BEFORE UPDATE OF status ON tickets
      WHEN NEW.status NOT IN ${VALID_TICKET_STATUSES}
      BEGIN
        SELECT RAISE(ABORT, 'Invalid ticket status');
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_desks_status_check_insert
      BEFORE INSERT ON desks
      WHEN NEW.status NOT IN ${VALID_DESK_STATUSES}
      BEGIN
        SELECT RAISE(ABORT, 'Invalid desk status');
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_desks_status_check_update
      BEFORE UPDATE OF status ON desks
      WHEN NEW.status NOT IN ${VALID_DESK_STATUSES}
      BEGIN
        SELECT RAISE(ABORT, 'Invalid desk status');
      END
    `);
  } catch (err) {
    logger.error('db', 'Failed to create status check triggers', { err });
  }

  // Prevent duplicate tickets for the same appointment (partial unique index)
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_appointment_unique ON tickets (appointment_id) WHERE appointment_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show')`); } catch { /* already exists */ }

  // ── Monotonic offline counter (no daily reset) ──
  // Replaces the per-day ticket_counter for L- prefix generation. Seeded
  // from the highest known sequence so offline tickets never reuse a number.
  db.exec(`CREATE TABLE IF NOT EXISTS ticket_counter_mono (
    office_id TEXT NOT NULL,
    dept_code TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (office_id, dept_code)
  )`);
  // Seed from any prior daily counters and from existing tickets so we never
  // collide with a number that was already issued locally.
  try {
    db.exec(`
      INSERT INTO ticket_counter_mono (office_id, dept_code, counter)
      SELECT office_id, dept_code, MAX(counter) FROM ticket_counter
      GROUP BY office_id, dept_code
      ON CONFLICT (office_id, dept_code) DO UPDATE
        SET counter = MAX(ticket_counter_mono.counter, excluded.counter)
    `);
  } catch { /* ticket_counter may not exist on fresh installs */ }
  try {
    db.exec(`
      INSERT INTO ticket_counter_mono (office_id, dept_code, counter)
      SELECT t.office_id, d.code, COALESCE(MAX(t.daily_sequence), 0)
      FROM tickets t
      JOIN departments d ON d.id = t.department_id
      WHERE d.code IS NOT NULL
      GROUP BY t.office_id, d.code
      ON CONFLICT (office_id, dept_code) DO UPDATE
        SET counter = MAX(ticket_counter_mono.counter, excluded.counter)
    `);
  } catch { /* tables may not exist on fresh installs */ }

  // Create tables that may not exist on older installations
  db.exec(`CREATE TABLE IF NOT EXISTS broadcast_templates (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    title TEXT NOT NULL,
    shortcut TEXT,
    body_fr TEXT,
    body_ar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_broadcast_templates_org ON broadcast_templates(organization_id)`);

  // One-time cleanup: remove demo/sample customers with @example.com emails
  try { db.exec(`DELETE FROM customers WHERE email LIKE '%@example.com'`); } catch { /* table may not exist yet */ }

  // Indexes that depend on migrated columns (must come after ALTER TABLEs)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_retry ON sync_queue(next_retry_at) WHERE synced_at IS NULL AND next_retry_at IS NOT NULL`); } catch { /* */ }

  // ── Integrity check on startup — detect corruption early ──
  try {
    const integrity = db.pragma('integrity_check') as any[];
    if (integrity?.[0]?.integrity_check !== 'ok') {
      logger.error('db', 'INTEGRITY CHECK FAILED', { integrity });
    }
  } catch (err) {
    logger.error('db', 'Could not run integrity check', { err });
  }

  // Cleanup old audit log entries (keep 90 days)
  try {
    const deleted = db.prepare("DELETE FROM ticket_audit_log WHERE created_at < datetime('now', '-90 days')").run();
    if (deleted.changes > 0) {
      logger.info('db', 'Cleaned up audit log entries older than 90 days', { count: deleted.changes });
    }
  } catch { /* table may not exist in some versions */ }

  // Cleanup old synced entries (keep 30 days of history)
  try {
    const deleted = db.prepare("DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < datetime('now', '-30 days')").run();
    if (deleted.changes > 0) {
      logger.info('db', 'Cleaned up old sync_queue entries', { count: deleted.changes });
    }
  } catch { /* ignore */ }

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
    logger.info('db', 'Cleaned up L-prefixed duplicate ticket rows', { count: lCleanup.changes });
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
    logger.error('audit', 'Failed to log ticket event', { err });
  }
}

// ── Timezone-aware local date ──────────────────────────────────────
// Returns YYYY-MM-DD in the office's configured timezone (falls back to system local)
export function getLocalDate(officeId?: string, dbInstance?: Database.Database): string {
  const d = dbInstance ?? db;
  if (officeId) {
    const office = d.prepare('SELECT timezone FROM offices WHERE id = ?').get(officeId) as any;
    if (office?.timezone) {
      const timezone = office.timezone === 'Europe/Algiers' ? 'Africa/Algiers' : office.timezone;
      return new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    }
  }
  // Fallback: system local date (NOT UTC)
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// ── Database backup ───────────────────────────────────────────────
// Creates a timestamped backup of the SQLite database using the safe
// backup API (atomic copy, no corruption risk even during writes).
// Keeps the last 7 backups, deleting older ones automatically.
export function backupDatabase(): { path: string; size: number } | null {
  try {
    const userDataPath = app.getPath('userData');
    const backupDir = path.join(userDataPath, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `qflo-${timestamp}.db`);

    // Use SQLite backup API (safe, atomic)
    db.backup(backupPath);

    const stats = fs.statSync(backupPath);
    logger.info('db:backup', 'Backup created', { backupPath, sizeKB: (stats.size / 1024).toFixed(1) });

    // Cleanup: keep only the last 7 backups
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('qflo-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (const old of backups.slice(7)) {
      try {
        fs.unlinkSync(path.join(backupDir, old));
        logger.info('db:backup', 'Cleaned up old backup', { file: old });
      } catch {}
    }

    return { path: backupPath, size: stats.size };
  } catch (err: any) {
    logger.error('db:backup', 'Backup failed', { error: err.message });
    return null;
  }
}

// Schedule automatic daily backup (call once on startup)
let backupTimer: ReturnType<typeof setInterval> | null = null;
export function startAutoBackup(intervalMs = 24 * 60 * 60 * 1000) {
  // Immediate backup on first start
  setTimeout(() => backupDatabase(), 5000);
  // Then every 24 hours
  backupTimer = setInterval(() => backupDatabase(), intervalMs);
}

export function stopAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

// Generate offline ticket number: L-{formatted}-{COUNTER}
// Monotonic per (office, dept_code) — never resets. Numbers always
// increase, even across days. Mirrors the cloud's monotonic strategy
// so offline and online numbers stay coherent.
// Respects org-level ticket_number_prefix + ticket_number_format settings.
export function generateOfflineTicketNumber(officeId: string, deptCode: string, dbInstance?: Database.Database): string {
  const d = dbInstance ?? db;

  const row = d.prepare(`
    INSERT INTO ticket_counter_mono (office_id, dept_code, counter, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT (office_id, dept_code)
    DO UPDATE SET counter = counter + 1, updated_at = datetime('now')
    RETURNING counter
  `).get(officeId, deptCode) as any;

  const num = String(row.counter).padStart(5, '0');

  // Read org settings for prefix/format from local cache
  let prefix = '';
  let format = 'dept_numeric';
  try {
    const orgRow = d.prepare(`
      SELECT o.settings FROM organizations o
      JOIN offices off ON off.organization_id = o.id
      WHERE off.id = ? LIMIT 1
    `).get(officeId) as any;
    if (orgRow?.settings) {
      const s = typeof orgRow.settings === 'string' ? JSON.parse(orgRow.settings) : orgRow.settings;
      prefix = s?.ticket_number_prefix ?? '';
      format = s?.ticket_number_format ?? 'dept_numeric';
    }
  } catch { /* non-critical — fall through to default */ }

  let formatted: string;
  switch (format) {
    case 'prefix_numeric':
      formatted = `${prefix}${num}`;
      break;
    case 'prefix_dept_numeric':
      formatted = `${prefix}${deptCode}-${num}`;
      break;
    default: // dept_numeric
      formatted = `${deptCode}-${num}`;
      break;
  }

  return `L-${formatted}`;
}

// ── Unified ticket number reservation ─────────────────────────────
// Single source of truth for ALL ticket creation paths.
// Online: calls Supabase RPC for atomic cloud sequence (no duplicates).
// Offline: falls back to local L-prefix with atomic SQLite counter.
export interface ReservedTicketNumber {
  ticketNumber: string;   // "G-032" or "L-G-005"
  dailySequence: number;  // 32 or 5
  isOffline: boolean;
}

export async function reserveTicketNumber(
  supabaseUrl: string,
  supabaseKey: string,
  officeId: string,
  departmentId: string,
  deptCode: string,
  isCloudReachable: boolean,
  dbInstance?: Database.Database,
  authToken?: string,
): Promise<ReservedTicketNumber> {
  const d = dbInstance ?? db;
  const bearerToken = authToken || supabaseKey;

  // ── Try cloud first (atomic, no race conditions) ──
  if (isCloudReachable) {
    // Try up to 2 times: first with auth token, then with anon key
    const tokensToTry = bearerToken !== supabaseKey
      ? [bearerToken, supabaseKey]  // auth token first, anon key fallback
      : [supabaseKey];              // only anon key available

    for (const token of tokensToTry) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/generate_daily_ticket_number`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ p_department_id: departmentId }),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const rows = await res.json();
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row?.ticket_num && row?.seq) {
            return {
              ticketNumber: row.ticket_num,
              dailySequence: row.seq,
              isOffline: false,
            };
          }
          logger.warn('reserveTicketNumber', 'RPC returned OK but no ticket_num/seq', { rows });
        } else {
          const body = await res.text().catch(() => '');
          logger.warn('reserveTicketNumber', 'RPC failed', { status: res.status, keyType: token === supabaseKey ? 'anon' : 'auth', body });
          // If auth token got 401/403, retry with anon key
          if ((res.status === 401 || res.status === 403) && token !== supabaseKey) {
            logger.info('reserveTicketNumber', 'Auth token rejected — retrying with anon key');
            continue;
          }
        }
        break; // success or non-auth error — don't retry
      } catch (err: any) {
        logger.warn('reserveTicketNumber', 'RPC error', { error: err?.message });
        break; // network error — don't retry with different token
      }
    }
  } else {
    logger.info('reserveTicketNumber', 'Cloud not reachable, using offline fallback');
  }

  // ── Offline fallback: atomic local counter ──
  const ticketNumber = generateOfflineTicketNumber(officeId, deptCode, d);
  // Extract sequence from L-G-005 → 5
  const match = ticketNumber.match(/-(\d+)$/);
  const dailySequence = match ? parseInt(match[1], 10) : 1;

  return {
    ticketNumber,
    dailySequence,
    isOffline: true,
  };
}
