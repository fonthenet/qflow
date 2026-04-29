import Database from 'better-sqlite3';

/** Create an in-memory SQLite database with the full QFlow schema */
export function createTestDB(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

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
      synced_at TEXT,
      organization_id TEXT,
      source TEXT DEFAULT 'local_kiosk',
      daily_sequence INTEGER DEFAULT 0,
      priority_category_id TEXT,
      locale TEXT,
      qr_token TEXT,
      delivery_address TEXT,
      assigned_rider_id TEXT,
      dispatched_at TEXT,
      arrived_at TEXT,
      delivered_at TEXT,
      checked_in_at TEXT,
      estimated_wait_minutes INTEGER
    );

    CREATE TABLE IF NOT EXISTS offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      organization_id TEXT,
      settings TEXT DEFAULT '{}',
      operating_hours TEXT DEFAULT '{}',
      timezone TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      office_id TEXT,
      organization_id TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      organization_id TEXT,
      estimated_service_time INTEGER DEFAULT 10,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS desks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      office_id TEXT,
      organization_id TEXT,
      is_active INTEGER DEFAULT 1,
      current_staff_id TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      full_name TEXT,
      email TEXT,
      role TEXT,
      office_id TEXT,
      department_id TEXT,
      organization_id TEXT,
      updated_at TEXT
    );

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
      next_retry_at TEXT,
      organization_id TEXT
    );

    CREATE TABLE IF NOT EXISTS session (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_counter (
      office_id TEXT NOT NULL,
      dept_code TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      date TEXT NOT NULL,
      PRIMARY KEY (office_id, dept_code, date)
    );

    CREATE TABLE IF NOT EXISTS ticket_counter_mono (
      office_id TEXT NOT NULL,
      dept_code TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (office_id, dept_code)
    );

    CREATE TABLE IF NOT EXISTS pending_signups (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_attempted_at TEXT,
      attempt_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      synced_org_id TEXT
    );

    CREATE TABLE IF NOT EXISTS broadcast_templates (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL,
      shortcut TEXT,
      body_fr TEXT,
      body_ar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_office_status ON tickets(office_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
  `);

  return db;
}

/** Atomic call-next SQL — same as main.ts handler */
export const CALL_NEXT_SQL = `
  UPDATE tickets
  SET status = 'called', desk_id = ?, called_by_staff_id = ?, called_at = ?
  WHERE id = (
    SELECT id FROM tickets
    WHERE office_id = ? AND status = 'waiting' AND parked_at IS NULL
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  )
  RETURNING *
`;
