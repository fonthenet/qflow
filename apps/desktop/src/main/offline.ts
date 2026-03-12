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

  db.run(`
    CREATE TABLE IF NOT EXISTS offline_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      service_id TEXT,
      department_id TEXT,
      office_id TEXT,
      status TEXT DEFAULT 'waiting',
      customer_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retries INTEGER DEFAULT 0,
      last_error TEXT
    )
  `);

  saveDb();
  console.log('Offline database initialized');
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

interface OfflineTicket {
  id: string;
  ticket_number: string;
  service_id?: string;
  department_id?: string;
  office_id?: string;
  status?: string;
  customer_name?: string;
  created_at: string;
  updated_at: string;
  data?: Record<string, unknown>;
}

export function saveTicketOffline(ticket: OfflineTicket): void {
  const database = getDb();

  database.run(
    `INSERT OR REPLACE INTO offline_tickets
      (id, ticket_number, service_id, department_id, office_id, status, customer_name, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticket.id,
      ticket.ticket_number,
      ticket.service_id || null,
      ticket.department_id || null,
      ticket.office_id || null,
      ticket.status || 'waiting',
      ticket.customer_name || null,
      ticket.created_at,
      ticket.updated_at,
      ticket.data ? JSON.stringify(ticket.data) : null,
    ]
  );

  database.run(
    `INSERT INTO sync_queue (action, table_name, record_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?)`,
    ['INSERT', 'tickets', ticket.id, JSON.stringify(ticket), new Date().toISOString()]
  );

  saveDb();
  console.log(`Ticket ${ticket.ticket_number} saved offline`);
}

interface SyncQueueItem {
  id: number;
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
  const results = database.exec('SELECT * FROM sync_queue ORDER BY created_at ASC');
  if (results.length === 0) return [];

  const columns = results[0].columns;
  return results[0].values.map((row: any[]) => {
    const item: any = {};
    columns.forEach((col: string, i: number) => {
      item[col] = row[i];
    });
    return item as SyncQueueItem;
  });
}

export async function syncToServer(supabaseUrl: string, supabaseKey: string): Promise<void> {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and key are required for sync');
  }

  const online = await isOnline();
  if (!online) {
    throw new Error('Cannot sync: server is not reachable');
  }

  const database = getDb();
  const queue = getSyncQueue();

  console.log(`Syncing ${queue.length} pending items...`);

  for (const item of queue) {
    try {
      const payload = JSON.parse(item.payload);
      const endpoint = `${supabaseUrl}/rest/v1/${item.table_name}`;

      let method = 'POST';
      if (item.action === 'UPDATE') method = 'PATCH';
      else if (item.action === 'DELETE') method = 'DELETE';

      const url =
        item.action === 'INSERT' ? endpoint : `${endpoint}?id=eq.${item.record_id}`;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
        body: item.action === 'DELETE' ? undefined : JSON.stringify(payload),
      });

      if (response.ok || response.status === 201 || response.status === 204) {
        database.run('DELETE FROM sync_queue WHERE id = ?', [item.id]);
        console.log(`Synced item ${item.id} (${item.action} ${item.table_name})`);
      } else {
        const errorText = await response.text();
        database.run('UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id = ?', [
          errorText,
          item.id,
        ]);
        console.error(`Failed to sync item ${item.id}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      database.run('UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id = ?', [
        String(error),
        item.id,
      ]);
      console.error(`Error syncing item ${item.id}:`, error);
    }
  }

  saveDb();
}

export async function getConnectionStatus(): Promise<{ online: boolean; pendingSyncs: number }> {
  const online = await isOnline();
  let pendingSyncs = 0;

  try {
    const database = getDb();
    const results = database.exec('SELECT COUNT(*) as count FROM sync_queue');
    if (results.length > 0 && results[0].values.length > 0) {
      pendingSyncs = results[0].values[0][0] as number;
    }
  } catch {
    // DB might not be initialized
  }

  return { online, pendingSyncs };
}
