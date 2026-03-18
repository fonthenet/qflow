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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tickets_office_status ON tickets(office_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
  `);

  return db;
}

export function getDB(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// Generate offline ticket number: L-{DEPT_CODE}-{COUNTER}
export function generateOfflineTicketNumber(officeId: string, deptCode: string): string {
  const today = new Date().toISOString().split('T')[0];

  const row = db.prepare(`
    INSERT INTO ticket_counter (office_id, dept_code, counter, date)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (office_id, dept_code, date)
    DO UPDATE SET counter = counter + 1
    RETURNING counter
  `).get(officeId, deptCode, today) as any;

  const num = String(row.counter).padStart(3, '0');
  return `L-${deptCode}-${num}`;
}
