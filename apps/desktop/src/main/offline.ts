import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// sql.js is loaded dynamically since it's ESM-compatible
let SQL: any = null;
let db: any = null;
let dbPath: string = '';

export async function initOffline(customDbPath?: string): Promise<void> {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  dbPath = customDbPath || path.join(app.getPath('userData'), 'queueflow-offline.db');
  console.log(`Opening offline database at: ${dbPath}`);

  // Load existing DB or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch {
    db = new SQL.Database();
  }

  // ── Schema ──────────────────────────────────────────────────────

  db.run(`
    CREATE TABLE IF NOT EXISTS offline_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      service_id TEXT,
      department_id TEXT,
      office_id TEXT,
      desk_id TEXT,
      status TEXT DEFAULT 'waiting',
      priority INTEGER DEFAULT 1,
      customer_name TEXT,
      customer_phone TEXT,
      customer_data TEXT,
      called_at TEXT,
      called_by_staff_id TEXT,
      serving_started_at TEXT,
      completed_at TEXT,
      parked_at TEXT,
      notes TEXT,
      appointment_id TEXT,
      is_remote INTEGER DEFAULT 0,
      recall_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS offline_counters (
      office_id TEXT NOT NULL,
      department_code TEXT NOT NULL,
      date TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      PRIMARY KEY (office_id, department_code, date)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT UNIQUE,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retries INTEGER DEFAULT 0,
      last_error TEXT,
      synced_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cached_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  saveDb();
  console.log('Offline database initialized with full queue schema');
}

function saveDb(): void {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('Failed to save offline DB:', err);
  }
}

function getDb(): any {
  if (!db) {
    throw new Error('Offline database not initialized. Call initOffline() first.');
  }
  return db;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ── Connection Check ──────────────────────────────────────────────

export async function isOnline(): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

// ── Offline Ticket Operations ─────────────────────────────────────

export function getNextTicketNumber(officeId: string, departmentCode: string): string {
  const database = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `L-${departmentCode.charAt(0).toUpperCase()}`;

  // Increment counter
  database.run(
    `INSERT INTO offline_counters (office_id, department_code, date, counter)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (office_id, department_code, date)
     DO UPDATE SET counter = counter + 1`,
    [officeId, departmentCode, today]
  );

  const result = database.exec(
    'SELECT counter FROM offline_counters WHERE office_id = ? AND department_code = ? AND date = ?',
    [officeId, departmentCode, today]
  );

  const counter = result.length > 0 ? result[0].values[0][0] : 1;
  saveDb();
  return `${prefix}-${String(counter).padStart(3, '0')}`;
}

interface CreateTicketParams {
  officeId: string;
  departmentId: string;
  departmentCode: string;
  serviceId: string;
  customerName?: string;
  customerPhone?: string;
  priority?: number;
  appointmentId?: string;
}

export function createTicketOffline(params: CreateTicketParams): any {
  const database = getDb();
  const id = generateUUID();
  const now = new Date().toISOString();
  const ticketNumber = getNextTicketNumber(params.officeId, params.departmentCode);

  const customerData = JSON.stringify({
    name: params.customerName || null,
    phone: params.customerPhone || null,
  });

  database.run(
    `INSERT INTO offline_tickets
      (id, ticket_number, service_id, department_id, office_id, status, priority,
       customer_name, customer_phone, customer_data, appointment_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ticketNumber, params.serviceId, params.departmentId, params.officeId,
      params.priority || 1,
      params.customerName || null, params.customerPhone || null,
      customerData, params.appointmentId || null,
      now, now,
    ]
  );

  // Queue for sync
  const ticket = {
    id, ticket_number: ticketNumber, service_id: params.serviceId,
    department_id: params.departmentId, office_id: params.officeId,
    status: 'waiting', priority: params.priority || 1,
    customer_data: { name: params.customerName, phone: params.customerPhone },
    appointment_id: params.appointmentId || null,
    created_at: now, updated_at: now,
  };

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`create-${id}`, 'INSERT', 'tickets', id, JSON.stringify(ticket), now]
  );

  saveDb();
  console.log(`Offline ticket created: ${ticketNumber}`);
  return ticket;
}

export function callTicketOffline(ticketId: string, deskId: string, staffId: string): boolean {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `UPDATE offline_tickets SET status = 'called', desk_id = ?, called_at = ?,
     called_by_staff_id = ?, updated_at = ? WHERE id = ?`,
    [deskId, now, staffId, now, ticketId]
  );

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`call-${ticketId}-${now}`, 'UPDATE', 'tickets', ticketId,
     JSON.stringify({ status: 'called', desk_id: deskId, called_at: now, called_by_staff_id: staffId }),
     now]
  );

  saveDb();
  return true;
}

export function serveTicketOffline(ticketId: string): boolean {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `UPDATE offline_tickets SET status = 'serving', serving_started_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, ticketId]
  );

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`serve-${ticketId}-${now}`, 'UPDATE', 'tickets', ticketId,
     JSON.stringify({ status: 'serving', serving_started_at: now }), now]
  );

  saveDb();
  return true;
}

export function completeTicketOffline(ticketId: string): boolean {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `UPDATE offline_tickets SET status = 'served', completed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, ticketId]
  );

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`complete-${ticketId}-${now}`, 'UPDATE', 'tickets', ticketId,
     JSON.stringify({ status: 'served', completed_at: now }), now]
  );

  saveDb();
  return true;
}

export function noShowTicketOffline(ticketId: string): boolean {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `UPDATE offline_tickets SET status = 'no_show', completed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, ticketId]
  );

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`noshow-${ticketId}-${now}`, 'UPDATE', 'tickets', ticketId,
     JSON.stringify({ status: 'no_show', completed_at: now }), now]
  );

  saveDb();
  return true;
}

export function cancelTicketOffline(ticketId: string): boolean {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `UPDATE offline_tickets SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, ticketId]
  );

  database.run(
    `INSERT INTO sync_queue (idempotency_key, action, table_name, record_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`cancel-${ticketId}-${now}`, 'UPDATE', 'tickets', ticketId,
     JSON.stringify({ status: 'cancelled', completed_at: now }), now]
  );

  saveDb();
  return true;
}

export function callNextOffline(officeId: string, deskId: string, staffId: string, departmentId?: string): any | null {
  const database = getDb();
  const now = new Date().toISOString();

  let query = `SELECT * FROM offline_tickets WHERE office_id = ? AND status = 'waiting' AND parked_at IS NULL`;
  const params: any[] = [officeId];

  if (departmentId) {
    query += ` AND department_id = ?`;
    params.push(departmentId);
  }

  query += ` ORDER BY priority DESC, created_at ASC LIMIT 1`;

  const result = database.exec(query, params);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const row = result[0].values[0];
  const ticket: any = {};
  columns.forEach((col: string, i: number) => { ticket[col] = row[i]; });

  // Update to called
  callTicketOffline(ticket.id, deskId, staffId);
  ticket.status = 'called';
  ticket.desk_id = deskId;
  ticket.called_at = now;

  return ticket;
}

export function getOfflineQueue(officeId: string): any[] {
  const database = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const result = database.exec(
    `SELECT * FROM offline_tickets
     WHERE office_id = ? AND created_at >= ? AND status NOT IN ('served', 'no_show', 'cancelled')
     ORDER BY priority DESC, created_at ASC`,
    [officeId, today + 'T00:00:00']
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map((row: any[]) => {
    const item: any = {};
    columns.forEach((col: string, i: number) => { item[col] = row[i]; });
    return item;
  });
}

// ── Config Cache ──────────────────────────────────────────────────

export function cacheConfig(key: string, value: any): void {
  const database = getDb();
  const now = new Date().toISOString();
  database.run(
    `INSERT OR REPLACE INTO cached_config (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, JSON.stringify(value), now]
  );
  saveDb();
}

export function getCachedConfig(key: string): any {
  const database = getDb();
  const result = database.exec('SELECT value FROM cached_config WHERE key = ?', [key]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  try { return JSON.parse(result[0].values[0][0] as string); } catch { return null; }
}

// ── Sync Engine ───────────────────────────────────────────────────

interface SyncQueueItem {
  id: number;
  idempotency_key: string;
  action: string;
  table_name: string;
  record_id: string;
  payload: string;
  created_at: string;
  retries: number;
  last_error: string | null;
}

export function getSyncQueue(): SyncQueueItem[] {
  const database = getDb();
  const results = database.exec('SELECT * FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at ASC');
  if (results.length === 0) return [];

  const columns = results[0].columns;
  return results[0].values.map((row: any[]) => {
    const item: any = {};
    columns.forEach((col: string, i: number) => { item[col] = row[i]; });
    return item as SyncQueueItem;
  });
}

export async function syncToServer(supabaseUrl: string, supabaseKey: string): Promise<{ synced: number; failed: number }> {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and key are required for sync');
  }

  const online = await isOnline();
  if (!online) {
    throw new Error('Cannot sync: server is not reachable');
  }

  const database = getDb();
  const queue = getSyncQueue();
  let synced = 0;
  let failed = 0;

  console.log(`Syncing ${queue.length} pending items...`);

  for (const item of queue) {
    if (item.retries >= 5) {
      console.warn(`Skipping item ${item.id} after ${item.retries} retries`);
      failed++;
      continue;
    }

    try {
      const payload = JSON.parse(item.payload);
      const endpoint = `${supabaseUrl}/rest/v1/${item.table_name}`;

      let method = 'POST';
      let url = endpoint;

      if (item.action === 'UPDATE') {
        method = 'PATCH';
        url = `${endpoint}?id=eq.${item.record_id}`;
      } else if (item.action === 'DELETE') {
        method = 'DELETE';
        url = `${endpoint}?id=eq.${item.record_id}`;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: item.action === 'INSERT' ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal',
      };

      const response = await fetch(url, {
        method,
        headers,
        body: item.action === 'DELETE' ? undefined : JSON.stringify(payload),
      });

      if (response.ok || response.status === 201 || response.status === 204 || response.status === 409) {
        const now = new Date().toISOString();
        database.run('UPDATE sync_queue SET synced_at = ? WHERE id = ?', [now, item.id]);
        synced++;
        console.log(`Synced item ${item.id} (${item.action} ${item.table_name})`);
      } else {
        const errorText = await response.text();
        database.run(
          'UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id = ?',
          [errorText, item.id]
        );
        failed++;
        console.error(`Failed to sync item ${item.id}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      database.run(
        'UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id = ?',
        [String(error), item.id]
      );
      failed++;
      console.error(`Error syncing item ${item.id}:`, error);
    }
  }

  // Cleanup old synced items (older than 24h)
  database.run(
    `DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < datetime('now', '-1 day')`
  );

  saveDb();
  return { synced, failed };
}

export async function getConnectionStatus(): Promise<{ online: boolean; pendingSyncs: number; lastSync: string | null }> {
  const online = await isOnline();
  let pendingSyncs = 0;
  let lastSync: string | null = null;

  try {
    const database = getDb();
    const countResult = database.exec('SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL');
    if (countResult.length > 0) {
      pendingSyncs = countResult[0].values[0][0] as number;
    }

    const lastResult = database.exec('SELECT MAX(synced_at) FROM sync_queue WHERE synced_at IS NOT NULL');
    if (lastResult.length > 0 && lastResult[0].values[0][0]) {
      lastSync = lastResult[0].values[0][0] as string;
    }
  } catch {
    // DB might not be initialized
  }

  return { online, pendingSyncs, lastSync };
}
