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

// ── Sync notifier hook ────────────────────────────────────────────
// Allows db.ts (which is low-level) to poke the sync engine when a
// row is enqueued, without taking a hard dependency on the engine.
// The sync engine registers a callback on startup via setSyncNotifier.
// When logTicketEvent (or future writers) enqueues a sync_queue row,
// it calls syncNotifier(syncId) to trigger an immediate push attempt
// instead of waiting up to 10s for the batch interval.
let syncNotifier: ((syncId: string) => void) | null = null;
export function setSyncNotifier(fn: ((syncId: string) => void) | null) {
  syncNotifier = fn;
}

/**
 * Single entry point for enqueueing rows into sync_queue. Every write MUST
 * go through here so the sync notifier fires consistently — no row can be
 * added without the sync engine knowing about it. Direct
 * `INSERT INTO sync_queue` statements are forbidden outside this file.
 *
 * Returns the syncId (opts.id) for convenience.
 */
/**
 * Derive the organization that owns a sync item so rows can be scoped
 * to the current session at replay time. Every table in the sync set
 * ultimately chains back to an organization — either directly (offices,
 * organizations) or through office_id / ticket_id. Returns null only if
 * the chain can't be resolved (e.g. a ticket_event whose parent ticket
 * isn't in local state yet).
 *
 * Exported so sync.ts can re-derive on legacy rows that pre-date the
 * organization_id column, and so tests can pin the behavior.
 */
export function deriveOrgIdForSyncItem(
  dbHandle: Database.Database,
  table: string,
  recordId: string,
  payload: Record<string, unknown>,
): string | null {
  try {
    // Direct hits first — the payload already carries the answer.
    if (table === 'organizations') {
      return (payload.id as string) ?? recordId ?? null;
    }
    if (table === 'offices') {
      return (payload.organization_id as string) ?? null;
    }
    const directOrg = payload.organization_id;
    if (typeof directOrg === 'string' && directOrg) return directOrg;

    // Anything keyed by office_id — tickets, departments, desks,
    // office_holidays, etc. — resolves via a single JOIN to offices.
    const officeId = payload.office_id;
    if (typeof officeId === 'string' && officeId) {
      const row = dbHandle.prepare(`SELECT organization_id FROM offices WHERE id = ? LIMIT 1`).get(officeId) as any;
      if (row?.organization_id) return row.organization_id;
    }

    // ticket_events and anything else referencing a ticket_id hop
    // through tickets → offices → organization_id.
    const ticketId = payload.ticket_id ?? (table === 'tickets' ? recordId : null);
    if (typeof ticketId === 'string' && ticketId) {
      const row = dbHandle.prepare(`
        SELECT o.organization_id
        FROM tickets t LEFT JOIN offices o ON o.id = t.office_id
        WHERE t.id = ? LIMIT 1
      `).get(ticketId) as any;
      if (row?.organization_id) return row.organization_id;
    }

    // Services hang off departments → offices.
    const departmentId = payload.department_id;
    if (typeof departmentId === 'string' && departmentId) {
      const row = dbHandle.prepare(`
        SELECT o.organization_id
        FROM departments d LEFT JOIN offices o ON o.id = d.office_id
        WHERE d.id = ? LIMIT 1
      `).get(departmentId) as any;
      if (row?.organization_id) return row.organization_id;
    }
  } catch { /* fall through to null */ }
  return null;
}

export function enqueueSync(opts: {
  id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'CALL';
  table: string;
  recordId: string;
  payload: Record<string, unknown>;
  createdAt?: string;
  /** Optional explicit override — callers who already know the org can
   *  skip the derivation lookup. Otherwise we derive from the payload. */
  organizationId?: string | null;
}): string {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const orgId = opts.organizationId ?? deriveOrgIdForSyncItem(db, opts.table, opts.recordId, opts.payload);

  // ── COALESCING: merge UPDATE/CALL into a pending INSERT for the same row ──
  // If there is an unsynced INSERT for this record, the cloud row does not
  // exist yet — a separate UPDATE replay would 0-rows because the target
  // isn't there. Merge our payload into the INSERT's payload so a single
  // POST captures the final state. Fewer round-trips, no orphan UPDATEs,
  // no "ghost" failures from update-before-insert ordering.
  //
  // Race note: there is a small window where syncNow may have already
  // started pushing the INSERT (await fetch in flight) when this merge
  // runs. In that window the merged payload would land in the queue but
  // the in-flight POST already serialized the prior payload. We accept
  // this — the window is one HTTP round-trip (~200ms) and the worst case
  // is one missed status transition that the operator notices and re-issues.
  if (opts.operation === 'UPDATE' || opts.operation === 'CALL') {
    const pendingInsert = db.prepare(
      `SELECT id, payload FROM sync_queue
       WHERE synced_at IS NULL AND table_name = ? AND record_id = ? AND operation = 'INSERT'
       ORDER BY created_at ASC LIMIT 1`
    ).get(opts.table, opts.recordId) as { id: string; payload: string } | undefined;

    if (pendingInsert) {
      let merged: Record<string, unknown>;
      try {
        const existing = JSON.parse(pendingInsert.payload) as Record<string, unknown>;
        merged = { ...existing, ...opts.payload };
      } catch {
        merged = { ...opts.payload };
      }
      db.prepare(
        `UPDATE sync_queue SET payload = ?, attempts = 0, last_error = NULL, next_retry_at = NULL
         WHERE id = ? AND synced_at IS NULL`
      ).run(JSON.stringify(merged), pendingInsert.id);
      try { syncNotifier?.(pendingInsert.id); } catch { /* non-fatal */ }
      return pendingInsert.id;
    }
  }

  // DELETE against a pending INSERT: both can be retired locally — the
  // cloud never saw the row, so the DELETE has nothing to delete. Mark
  // the INSERT as resolved with a clear COALESCED tag.
  if (opts.operation === 'DELETE') {
    const pendingInsert = db.prepare(
      `SELECT id FROM sync_queue
       WHERE synced_at IS NULL AND table_name = ? AND record_id = ? AND operation = 'INSERT'
       ORDER BY created_at ASC LIMIT 1`
    ).get(opts.table, opts.recordId) as { id: string } | undefined;

    if (pendingInsert) {
      db.prepare(
        `UPDATE sync_queue SET synced_at = ?, last_error = ? WHERE id = ? AND synced_at IS NULL`
      ).run(new Date().toISOString(), 'COALESCED: created and deleted before sync', pendingInsert.id);
      return pendingInsert.id;
    }
  }

  db.prepare(`
    INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(opts.id, opts.operation, opts.table, opts.recordId, JSON.stringify(opts.payload), createdAt, orgId);
  try { syncNotifier?.(opts.id); } catch { /* non-fatal */ }
  return opts.id;
}

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
      delivery_address TEXT,
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

    -- Local draft cache for customer notes + rich-text customer_file.
    -- Safety net so offline edits aren't lost when Supabase auto-save fails.
    -- Drafts are cleared once the cloud write succeeds, so this should stay tiny.
    CREATE TABLE IF NOT EXISTS customer_drafts (
      customer_id TEXT PRIMARY KEY,
      notes TEXT,
      customer_file TEXT,
      updated_at INTEGER NOT NULL
    );

    -- Menu categories (mirror of cloud menu_categories)
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      icon TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    -- Menu items (mirror of cloud menu_items)
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      discount_percent INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      prep_time_minutes INTEGER,
      is_available INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- Ticket items (items added to a specific seated ticket).
    -- name/price are snapshotted so menu edits don't rewrite history.
    CREATE TABLE IF NOT EXISTS ticket_items (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      menu_item_id TEXT,
      name TEXT NOT NULL,
      price REAL,
      qty INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      added_at TEXT NOT NULL,
      added_by TEXT,
      kitchen_status TEXT NOT NULL DEFAULT 'new',
      kitchen_status_at TEXT NULL
    );

    -- Payments captured at checkout. Cash-only for now; schema keeps
    -- method flexible so card/edahabia can drop in later without a
    -- migration. Amount = total charged; tendered/change_given only
    -- meaningful for cash.
    CREATE TABLE IF NOT EXISTS ticket_payments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      amount REAL NOT NULL,
      tendered REAL,
      change_given REAL,
      note TEXT,
      paid_at TEXT NOT NULL,
      paid_by TEXT
    );

    -- Printers are per-station local config (not synced). Holds the
    -- Windows printer driver name + width so the print service can
    -- route receipts to the right device. is_default=1 selects the
    -- default receipt printer on checkout.
    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      driver_name TEXT NOT NULL,
      width_mm INTEGER NOT NULL DEFAULT 80,
      kind TEXT NOT NULL DEFAULT 'receipt',
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    -- Restaurant tables (floor map). Synced from Supabase. Column set
    -- mirrors the canonical schema used by Station's FloorMap component.
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id TEXT PRIMARY KEY,
      office_id TEXT NOT NULL,
      code TEXT,
      label TEXT,
      zone TEXT,
      capacity INTEGER NOT NULL DEFAULT 4,
      min_party_size INTEGER,
      max_party_size INTEGER,
      reservable INTEGER NOT NULL DEFAULT 1,
      status TEXT,
      current_ticket_id TEXT,
      assigned_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- Indexes (only on columns guaranteed to exist in CREATE TABLE above)
    CREATE INDEX IF NOT EXISTS idx_restaurant_tables_office ON restaurant_tables(office_id);
    CREATE INDEX IF NOT EXISTS idx_broadcast_templates_org ON broadcast_templates(organization_id);
    CREATE INDEX IF NOT EXISTS idx_office_holidays_lookup ON office_holidays(office_id, holiday_date);
    CREATE INDEX IF NOT EXISTS idx_tickets_office_status ON tickets(office_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_dept ON tickets(department_id, status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_menu_categories_org ON menu_categories(organization_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_menu_items_org ON menu_items(organization_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_payments_ticket ON ticket_payments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_payments_org_date ON ticket_payments(organization_id, paid_at);
  `);

  // ── Safe schema migrations (idempotent) ──
  // Each ALTER TABLE is wrapped in try/catch — if the column already exists, it silently skips.
  try { db.exec(`ALTER TABLE offices ADD COLUMN timezone TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE offices ADD COLUMN operating_hours TEXT DEFAULT '{}'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sync_queue ADD COLUMN next_retry_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE sync_queue ADD COLUMN already_notified INTEGER DEFAULT 0`); } catch { /* already exists */ }
  // organization_id stamped at enqueue so the sync engine can scope
  // replay by business. Without it, rows queued under one business
  // silently try to replay under another (different RLS, different
  // auth), either failing forever or — worse — leaking data.
  try { db.exec(`ALTER TABLE sync_queue ADD COLUMN organization_id TEXT`); } catch { /* already exists */ }
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
  try { db.exec(`ALTER TABLE tickets ADD COLUMN delivery_address TEXT`); } catch { /* already exists */ }
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

  // Local customer draft cache (migration for existing installs — must match initial schema above).
  db.exec(`CREATE TABLE IF NOT EXISTS customer_drafts (
    customer_id TEXT PRIMARY KEY,
    notes TEXT,
    customer_file TEXT,
    updated_at INTEGER NOT NULL
  )`);

  // Menu tables (migration for existing installs — must match initial schema above).
  db.exec(`CREATE TABLE IF NOT EXISTS menu_categories (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    icon TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
  )`);
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN prep_time_minutes INTEGER`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE menu_items ADD COLUMN image_url TEXT`); } catch { /* already exists */ }
  db.exec(`CREATE TABLE IF NOT EXISTS ticket_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    menu_item_id TEXT,
    name TEXT NOT NULL,
    price REAL,
    qty INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    added_at TEXT NOT NULL,
    added_by TEXT,
    kitchen_status TEXT NOT NULL DEFAULT 'new',
    kitchen_status_at TEXT NULL
  )`);
  // KDS columns — add to existing databases that pre-date this migration.
  // SQLite's ALTER TABLE ADD COLUMN with NOT NULL DEFAULT only backfills
  // rows when run as a single statement on an empty/new column; if a
  // prior partial run added the column without the default (or pulled
  // rows from cloud sync that left kitchen_status NULL), we must backfill
  // explicitly. Otherwise `kitchen_status != 'served'` filters NULL rows
  // out (NULL != 'served' is NULL, not TRUE) and the KDS shows nothing.
  try { db.exec(`ALTER TABLE ticket_items ADD COLUMN kitchen_status TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ticket_items ADD COLUMN kitchen_status_at TEXT NULL`); } catch { /* already exists */ }
  try { db.exec(`UPDATE ticket_items SET kitchen_status = 'new' WHERE kitchen_status IS NULL OR kitchen_status = ''`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_items_kitchen ON ticket_items(organization_id, kitchen_status, added_at) WHERE kitchen_status != 'served'`); } catch { /* */ }
  db.exec(`CREATE TABLE IF NOT EXISTS ticket_payments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash',
    amount REAL NOT NULL,
    tendered REAL,
    change_given REAL,
    note TEXT,
    paid_at TEXT NOT NULL,
    paid_by TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS printers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    width_mm INTEGER NOT NULL DEFAULT 80,
    kind TEXT NOT NULL DEFAULT 'receipt',
    is_default INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT
  )`);
  // Restaurant tables — synced from Supabase, used by the floor map on
  // Station + Expo (via the /api/station/query bridge in local mode).
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_tables (
    id TEXT PRIMARY KEY,
    office_id TEXT NOT NULL,
    code TEXT,
    label TEXT,
    zone TEXT,
    capacity INTEGER NOT NULL DEFAULT 4,
    min_party_size INTEGER,
    max_party_size INTEGER,
    reservable INTEGER NOT NULL DEFAULT 1,
    status TEXT,
    current_ticket_id TEXT,
    assigned_at TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_restaurant_tables_office ON restaurant_tables(office_id)`); } catch { /* */ }

  // Drop legacy payment methods cache (org_payment_methods table was removed from Supabase).
  db.exec(`DROP TABLE IF EXISTS org_payment_methods_cache`);
  try { db.exec(`ALTER TABLE tickets ADD COLUMN payment_status TEXT`); } catch { /* already exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_payments_ticket ON ticket_payments(ticket_id)`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_payments_org_date ON ticket_payments(organization_id, paid_at)`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_menu_categories_org ON menu_categories(organization_id, sort_order)`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id, sort_order)`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_menu_items_org ON menu_items(organization_id)`); } catch { /* */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id)`); } catch { /* */ }

  // One-time cleanup: remove demo/sample customers with @example.com emails
  try { db.exec(`DELETE FROM customers WHERE email LIKE '%@example.com'`); } catch { /* table may not exist yet */ }

  // Indexes that depend on migrated columns (must come after ALTER TABLEs)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_retry ON sync_queue(next_retry_at) WHERE synced_at IS NULL AND next_retry_at IS NOT NULL`); } catch { /* */ }
  // Scoped-replay index: lets syncNow pull pending items for the active
  // organization in O(log n) instead of scanning the whole queue.
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_org_pending ON sync_queue(organization_id, synced_at) WHERE synced_at IS NULL`); } catch { /* */ }

  // One-shot backfill: older queued rows pre-date the organization_id
  // column. Try to derive it from the payload / referenced records so
  // existing offline state survives the migration. Rows we can't
  // resolve stay NULL — the scoped syncNow treats NULL as "attempt
  // under whatever session is active", preserving legacy behavior.
  try {
    const missing = db.prepare(
      `SELECT id, table_name, record_id, payload
       FROM sync_queue
       WHERE synced_at IS NULL AND organization_id IS NULL
       LIMIT 5000`,
    ).all() as Array<{ id: string; table_name: string; record_id: string; payload: string }>;
    if (missing.length > 0) {
      const update = db.prepare(`UPDATE sync_queue SET organization_id = ? WHERE id = ?`);
      let filled = 0;
      for (const row of missing) {
        try {
          const parsed = row.payload ? JSON.parse(row.payload) : {};
          const orgId = deriveOrgIdForSyncItem(db, row.table_name, row.record_id, parsed);
          if (orgId) { update.run(orgId, row.id); filled++; }
        } catch { /* skip malformed */ }
      }
      if (filled > 0) logger.info('db.migrate', 'Backfilled organization_id on sync_queue', { filled, scanned: missing.length });
    }
  } catch (err: any) {
    logger.warn('db.migrate', 'Backfill failed (non-fatal)', { error: err?.message });
  }

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

      // Route through enqueueSync so the notifier fires consistently
      // (keeps ticket_events moving instead of sitting at attempts=0).
      enqueueSync({
        id: syncId,
        operation: 'INSERT',
        table: 'ticket_events',
        recordId: syncId,
        payload: cloudPayload,
        createdAt: now,
      });
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
