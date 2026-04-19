import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';
import {
  recoverDatabaseIfNeeded,
  checkOpenDatabaseIntegrity,
  checkIntegrity as checkIntegrityOfFile,
  quarantineDatabase,
  type RecoveryOutcome,
} from './db-integrity';

let db: Database.Database;

// The outcome of the last startup recovery pass. Consumed by main.ts
// to surface a banner in the renderer ("Local database was repaired...")
// or to trigger a forced re-login + full resync when we started fresh.
let lastRecovery: RecoveryOutcome | null = null;
export function getLastRecovery(): RecoveryOutcome | null {
  return lastRecovery;
}

export function initDB() {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  const backupDir = path.join(userDataPath, 'backups');

  // Ensure directories exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'qflo.db');

  // ── Pre-open corruption recovery ──────────────────────────────────
  // Run integrity checks BEFORE opening the main handle. If the file
  // is corrupt we quarantine it and restore from the newest healthy
  // backup (or start fresh and let the sync engine rehydrate from the
  // cloud). This is the commercial-grade guard: users never see
  // mystery failures caused by a bad page — the app heals itself.
  lastRecovery = recoverDatabaseIfNeeded({ dbPath, backupDir });
  if (lastRecovery.action !== 'healthy') {
    logger.warn('db', 'Database auto-recovery executed', lastRecovery);
  }

  db = openDatabaseWithFallback(dbPath, backupDir);
  // pragmas (journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON)
  // are set inside openDatabaseWithFallback so they apply on fallback
  // paths too — do not re-set here.

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
      priority_category_id TEXT,
      locale TEXT,
      qr_token TEXT,
      checked_in_at TEXT,
      estimated_wait_minutes INTEGER
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
      status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','on_break')),
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
  try { db.exec(`ALTER TABLE tickets ADD COLUMN qr_token TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN checked_in_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE tickets ADD COLUMN estimated_wait_minutes INTEGER`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE desks ADD COLUMN status TEXT DEFAULT 'open'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE desks ADD COLUMN display_name TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE session ADD COLUMN station_token TEXT`); } catch { /* already exists */ }

  // ── Migrate away from the old desks.status CHECK constraint ────────────
  // Original schema used CHECK(status IN ('open','closed','paused','break'))
  // but cloud uses ('open','closed','on_break'). SQLite can't ALTER CHECK in
  // place, and the writable_schema hack doesn't take effect until the DB is
  // reopened — the current connection keeps enforcing the cached old CHECK.
  // So use SQLite's canonical table-rebuild pattern: create a new table with
  // the correct CHECK, copy rows over, drop the old table, rename. The new
  // constraint takes effect immediately on the open connection.
  try {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'desks'"
    ).get() as { sql?: string } | undefined;
    const existingSql = row?.sql ?? '';
    const hasCheck = /CHECK\s*\(\s*status\s+IN\s*\(/i.test(existingSql);
    const allowsOnBreak = /'on_break'/.test(existingSql);
    if (hasCheck && !allowsOnBreak) {
      logger.info('db', 'Migrating desks.status CHECK constraint to (open, closed, on_break)');
      db.transaction(() => {
        // Normalize any rows that still carry the obsolete statuses so the
        // INSERT into the new table won't fail on the fresh CHECK.
        db.exec(`UPDATE desks SET status = 'on_break' WHERE status IN ('paused','break')`);
        // Drop the existing BEFORE-UPDATE/INSERT triggers (if any) so they
        // don't fire during the copy. They'll be recreated just below.
        db.exec(`DROP TRIGGER IF EXISTS trg_desks_status_check_insert`);
        db.exec(`DROP TRIGGER IF EXISTS trg_desks_status_check_update`);
        db.exec(`
          CREATE TABLE desks_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            department_id TEXT,
            office_id TEXT,
            is_active INTEGER DEFAULT 1,
            status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','on_break')),
            current_staff_id TEXT,
            updated_at TEXT
          )
        `);
        db.exec(`
          INSERT INTO desks_new (id, name, display_name, department_id, office_id, is_active, status, current_staff_id, updated_at)
          SELECT id, name, display_name, department_id, office_id, is_active, status, current_staff_id, updated_at
          FROM desks
        `);
        db.exec(`DROP TABLE desks`);
        db.exec(`ALTER TABLE desks_new RENAME TO desks`);
      })();
      const integrity = db.prepare('PRAGMA integrity_check').get() as any;
      logger.info('db', 'desks CHECK migration complete', { integrity: integrity?.integrity_check });
    }
  } catch (err: any) {
    logger.error('db', 'Failed to migrate desks CHECK constraint', { error: err?.message });
  }

  // ── CHECK constraint enforcement via triggers (for existing DBs without inline CHECKs) ──
  // SQLite cannot ALTER TABLE to add CHECK constraints, so we use BEFORE triggers.
  // Desk statuses MUST match the cloud schema (('open','closed','on_break')) so
  // values round-trip through sync. An earlier version of this file used
  // ('paused','break') here — drop the old triggers before recreating so old
  // DBs get the corrected allow-list.
  const VALID_TICKET_STATUSES = `('issued','pending_approval','waiting','called','serving','served','cancelled','no_show','transferred','parked')`;
  const VALID_DESK_STATUSES = `('open','closed','on_break')`;
  try {
    db.exec(`DROP TRIGGER IF EXISTS trg_desks_status_check_insert`);
    db.exec(`DROP TRIGGER IF EXISTS trg_desks_status_check_update`);
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
      CREATE TRIGGER trg_desks_status_check_insert
      BEFORE INSERT ON desks
      WHEN NEW.status NOT IN ${VALID_DESK_STATUSES}
      BEGIN
        SELECT RAISE(ABORT, 'Invalid desk status');
      END
    `);
    db.exec(`
      CREATE TRIGGER trg_desks_status_check_update
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

  // ── Post-open integrity check ─────────────────────────────────────
  // recoverDatabaseIfNeeded already ran a read-only integrity check
  // before we opened. This is a belt-and-braces second pass: opening
  // a DB can replay a stale WAL and reveal corruption the pre-open
  // check missed. If it fails here, we cannot continue — throwing
  // trips the outer handler in main.ts which restarts the app with a
  // clean DB.
  const postOpen = checkOpenDatabaseIntegrity(db);
  if (!postOpen.ok) {
    logger.error('db', 'Post-open integrity check failed — aborting initDB', postOpen);
    try { db.close(); } catch { /* already bad */ }
    quarantineDatabase(dbPath);
    throw new Error(`Database corrupt after open: ${postOpen.reason}`);
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

// ── Defensive DB open ─────────────────────────────────────────────
// `new Database(path)` can throw SQLITE_CORRUPT on open when a stale
// WAL references freed pages, even though the pre-open read-only
// probe succeeded. When that happens, quarantine and retry with a
// clean file (restored from backup if we have one, else empty).
// After one retry, give up and let the error propagate — at that
// point, something outside SQLite is wrong (disk, permissions, A/V)
// and silently continuing would hide the real problem.
function openDatabaseWithFallback(dbPath: string, backupDir: string): Database.Database {
  try {
    const handle = new Database(dbPath);
    handle.pragma('journal_mode = WAL');
    handle.pragma('synchronous = NORMAL');
    handle.pragma('foreign_keys = ON');
    return handle;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    logger.error('db', 'Primary DB open failed — attempting recovery', { error: msg });
    quarantineDatabase(dbPath);
    // Re-run recovery now that the broken file is out of the way.
    // recoverDatabaseIfNeeded is a no-op when the file is missing and
    // will restore from backup if a healthy one exists.
    lastRecovery = recoverDatabaseIfNeeded({ dbPath, backupDir });
    const retry = new Database(dbPath);
    retry.pragma('journal_mode = WAL');
    retry.pragma('synchronous = NORMAL');
    retry.pragma('foreign_keys = ON');
    logger.warn('db', 'DB reopened after fallback', { outcome: lastRecovery });
    return retry;
  }
}

// ── Manual rebuild from cloud ─────────────────────────────────────
// Exposed through IPC for the Settings → Advanced → "Rebuild local
// database" action, and used by main.ts when startup recovery left us
// on a fresh empty DB (so sync can tell the user to re-login).
//
// Caller MUST stop the sync engine before calling and restart the app
// after — we don't try to hot-swap the `db` singleton while other
// modules hold references to it.
export function prepareFreshDatabase(): { quarantined: string } {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'data', 'qflo.db');
  try { db?.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
  try { db?.close(); } catch { /* already closed */ }
  const quarantined = quarantineDatabase(dbPath);
  logger.warn('db', 'Fresh database requested — quarantined current DB', { quarantined });
  return { quarantined };
}

// ── Graceful DB shutdown ─────────────────────────────────────────
// Checkpoint WAL to main DB file, then close the connection.
// MUST be called during app shutdown to prevent data loss when
// the NSIS installer force-kills the process during updates.
export function closeDB() {
  if (!db) return;
  try {
    // Force WAL checkpoint — flushes all pending writes to the main DB file
    db.pragma('wal_checkpoint(TRUNCATE)');
    logger.info('db', 'WAL checkpoint completed');
  } catch (err: any) {
    logger.error('db', 'WAL checkpoint failed', { error: err?.message });
  }
  try {
    db.close();
    logger.info('db', 'Database closed gracefully');
  } catch (err: any) {
    logger.error('db', 'Database close failed', { error: err?.message });
  }
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
    /** Set to true to also enqueue a cloud sync of this event to ticket_events */
    syncToCloud?: boolean;
  }
) {
  const now = new Date().toISOString();
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
      now
    );
  } catch (err) {
    logger.error('audit', 'Failed to log ticket event', { err });
  }

  // Also enqueue cloud sync to ticket_events table
  if (opts?.syncToCloud !== false) {
    try {
      // Deterministic idempotency key: ensures the same event is never duplicated
      // even if synced from multiple retries or multiple Stations.
      const epochMs = new Date(now).getTime();
      const idempotencyKey = `${ticketId}-${eventType}-${epochMs}`;
      const syncId = `evt-${idempotencyKey}`;

      const cloudPayload: Record<string, unknown> = {
        ticket_id: ticketId,
        event_type: eventType,
        from_status: opts?.fromStatus ?? null,
        to_status: opts?.toStatus ?? null,
        source: opts?.source ?? 'station',
        idempotency_key: idempotencyKey,
        created_at: now,
      };
      // Include staff_id and desk_id if available (must be valid UUIDs or null)
      if (opts?.details?.staffId && typeof opts.details.staffId === 'string' && opts.details.staffId.length > 30) {
        cloudPayload.staff_id = opts.details.staffId;
      }
      if (opts?.details?.deskId && typeof opts.details.deskId === 'string' && opts.details.deskId.length > 30) {
        cloudPayload.desk_id = opts.details.deskId;
      }
      // Metadata: strip staffId/deskId (already in dedicated columns) to keep payload clean
      if (opts?.details) {
        const { staffId, deskId, ...rest } = opts.details;
        if (Object.keys(rest).length > 0) cloudPayload.metadata = rest;
      }

      db.prepare(`
        INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
        VALUES (?, 'INSERT', 'ticket_events', ?, ?, ?)
      `).run(syncId, syncId, JSON.stringify(cloudPayload), now);
    } catch (err) {
      logger.error('audit', 'Failed to enqueue ticket_event cloud sync', { err });
    }
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

    // Refuse to snapshot a corrupt source. A backup of a bad DB is
    // worse than no backup — it poisons the recovery pool.
    const sourceCheck = checkOpenDatabaseIntegrity(db);
    if (!sourceCheck.ok) {
      logger.error('db:backup', 'Source DB failed integrity check — refusing to back up', sourceCheck);
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `qflo-${timestamp}.db`);

    // Use SQLite backup API (safe, atomic)
    db.backup(backupPath);

    // Verify the backup we just wrote. If it fails, delete it so the
    // recovery scanner never picks a corrupt file.
    const verify = checkIntegrityOfFile(backupPath);
    if (!verify.ok) {
      logger.error('db:backup', 'Backup failed integrity verification — deleting', { backupPath, verify });
      try { fs.unlinkSync(backupPath); } catch { /* best-effort */ }
      return null;
    }

    const stats = fs.statSync(backupPath);
    logger.info('db:backup', 'Backup created and verified', { backupPath, sizeKB: (stats.size / 1024).toFixed(1) });

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
