import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { initDB, getDB } from './db';
import { SyncEngine } from './sync';
import { startKioskServer, stopKioskServer, getLocalIP, notifyDisplays, type SSEEvent } from './kiosk-server';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let syncEngine: SyncEngine | null = null;
let kioskUrl: string | null = null;

const SUPABASE_URL = 'https://ofyyzuocifigyyhqxxqw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'QueueFlow Station',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0f172a',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Dev or production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use a simple 16x16 icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfElEQVQ4T2NkoBAwUqifYdAb8P///38GIwYGhv8MDIxAxsLv////32BkYNzIwMi4AeYCRkbGBf///9/IxMT0n5GR8T8DA+N/BgaG/0AGsgJkF8CczsjI+B9mALoNyC5AdgGGF9BdgOwCDC+guwDZBRheQHcBsgtgXmAgN1kDANvOXxHMfqm4AAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);
  updateTrayMenu('connecting');

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function updateTrayMenu(status: 'online' | 'offline' | 'syncing' | 'connecting') {
  if (!tray) return;

  const statusLabels: Record<string, string> = {
    online: '● Online — Connected to cloud',
    offline: '○ Offline — Using local data',
    syncing: '↻ Syncing...',
    connecting: '… Connecting...',
  };

  const menu = Menu.buildFromTemplate([
    { label: 'QueueFlow Station v1.0.0', enabled: false },
    { type: 'separator' },
    { label: statusLabels[status], enabled: false },
    { type: 'separator' },
    { label: 'Open Station', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`QueueFlow Station — ${status}`);
}

// ── IPC Handlers ──────────────────────────────────────────────────────

function setupIPC() {
  const db = getDB();

  // Get connection config
  ipcMain.handle('get-config', () => ({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  }));

  // ── Offline Queue Operations ──────────────────────────────────────

  ipcMain.handle('db:get-tickets', (_e, officeIdOrIds: string | string[], statuses: string[]) => {
    const ids = Array.isArray(officeIdOrIds) ? officeIdOrIds : [officeIdOrIds];
    if (!ids.length) return [];
    const officePlaceholders = ids.map(() => '?').join(',');
    const statusPlaceholders = statuses.map(() => '?').join(',');
    // NEVER filter active tickets by date — if it's waiting, show it
    const result = db.prepare(
      `SELECT * FROM tickets WHERE office_id IN (${officePlaceholders}) AND status IN (${statusPlaceholders})
       ORDER BY priority DESC, created_at ASC`
    ).all(...ids, ...statuses);
    return result;
  });

  ipcMain.handle('db:create-ticket', (_e, ticket: any) => {
    db.prepare(`
      INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline)
      VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, 1)
    `).run(ticket.id, ticket.ticket_number, ticket.office_id, ticket.department_id, ticket.service_id, ticket.priority ?? 0, JSON.stringify(ticket.customer_data ?? {}), ticket.created_at ?? new Date().toISOString());

    // Queue for sync
    db.prepare(`
      INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
      VALUES (?, 'INSERT', 'tickets', ?, ?, ?)
    `).run(ticket.id + '-create', ticket.id, JSON.stringify(ticket), new Date().toISOString());

    notifyDisplays({ type: 'ticket_created', ticket_number: ticket.ticket_number, timestamp: new Date().toISOString() });
    return ticket;
  });

  ipcMain.handle('db:update-ticket', (_e, ticketId: string, updates: any) => {
    const sets = Object.entries(updates)
      .map(([key]) => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    db.prepare(`UPDATE tickets SET ${sets} WHERE id = ?`).run(...values, ticketId);

    // Queue for sync
    const syncId = `${ticketId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
      VALUES (?, 'UPDATE', 'tickets', ?, ?, ?)
    `).run(syncId, ticketId, JSON.stringify(updates), new Date().toISOString());

    // Push typed SSE event based on status change
    if (updates.status === 'served' || updates.status === 'no_show') {
      notifyDisplays({ type: 'ticket_served', timestamp: new Date().toISOString() });
    } else if (updates.status === 'cancelled') {
      notifyDisplays({ type: 'ticket_cancelled', timestamp: new Date().toISOString() });
    } else if (updates.status === 'called') {
      const dsk = updates.desk_id ? db.prepare('SELECT name FROM desks WHERE id = ?').get(updates.desk_id) as any : null;
      const tk = db.prepare('SELECT ticket_number FROM tickets WHERE id = ?').get(ticketId) as any;
      notifyDisplays({ type: 'ticket_called', ticket_number: tk?.ticket_number, desk_name: dsk?.name, timestamp: new Date().toISOString() });
    } else {
      notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    }
    return { id: ticketId, ...updates };
  });

  ipcMain.handle('db:query', (_e, table: string, officeIds: string[]) => {
    if (!officeIds?.length) return [];
    const placeholders = officeIds.map(() => '?').join(',');
    switch (table) {
      case 'departments':
        return db.prepare(`SELECT id, name FROM departments WHERE office_id IN (${placeholders})`).all(...officeIds);
      case 'services':
        return db.prepare(`SELECT id, name, department_id FROM services`).all();
      case 'desks':
        return db.prepare(`SELECT id, name FROM desks WHERE office_id IN (${placeholders})`).all(...officeIds);
      default:
        return [];
    }
  });

  ipcMain.handle('db:call-next', (_e, officeId: string, deskId: string, staffId: string) => {
    const now = new Date().toISOString();

    // ATOMIC: single UPDATE...RETURNING prevents two desks calling the same ticket
    const ticket = db.prepare(`
      UPDATE tickets
      SET status = 'called', desk_id = ?, called_by_staff_id = ?, called_at = ?
      WHERE id = (
        SELECT id FROM tickets
        WHERE office_id = ? AND status = 'waiting' AND parked_at IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      )
      RETURNING *
    `).get(deskId, staffId, now, officeId) as any;

    if (!ticket) return null;

    // Queue sync
    db.prepare(`
      INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
      VALUES (?, 'CALL', 'tickets', ?, ?, ?)
    `).run(`${ticket.id}-call-${Date.now()}`, ticket.id, JSON.stringify({ status: 'called', desk_id: deskId, called_by_staff_id: staffId, called_at: now }), now);

    // Instant push with typed event
    const desk = db.prepare('SELECT name FROM desks WHERE id = ?').get(deskId) as any;
    notifyDisplays({
      type: 'ticket_called',
      ticket_number: ticket.ticket_number,
      desk_name: desk?.name ?? deskId,
      timestamp: now,
    });
    return ticket;
  });

  // ── Sync Status ───────────────────────────────────────────────────

  ipcMain.handle('sync:status', () => ({
    isOnline: syncEngine?.isOnline ?? false,
    pendingCount: syncEngine?.pendingCount ?? 0,
    lastSyncAt: syncEngine?.lastSyncAt ?? null,
  }));

  ipcMain.handle('sync:force', async () => {
    syncEngine?.suppressAuthErrors(); // prevent stale-session race from kicking user out
    await syncEngine?.syncNow();
    await syncEngine?.pullLatest();
    notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
  });

  ipcMain.handle('sync:pending-details', () => {
    return db.prepare(
      "SELECT id, operation, table_name, record_id, attempts, last_error, created_at FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at ASC"
    ).all();
  });

  ipcMain.handle('sync:discard-item', (_e, id: string) => {
    db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
    syncEngine?.updatePendingCount?.();
  });

  ipcMain.handle('sync:discard-all', () => {
    db.prepare("DELETE FROM sync_queue WHERE synced_at IS NULL").run();
    syncEngine?.updatePendingCount?.();
  });

  ipcMain.handle('sync:retry-item', async (_e, id: string) => {
    db.prepare("UPDATE sync_queue SET attempts = 0, last_error = NULL, next_retry_at = NULL WHERE id = ?").run(id);
    await syncEngine?.syncNow();
  });

  // ── Session ───────────────────────────────────────────────────────

  ipcMain.handle('session:save', (_e, session: any) => {
    db.prepare(`
      INSERT OR REPLACE INTO session (key, value)
      VALUES ('current', ?)
    `).run(JSON.stringify(session));
  });

  ipcMain.handle('session:load', () => {
    const row = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    return row ? JSON.parse(row.value) : null;
  });

  ipcMain.handle('session:clear', () => {
    db.prepare("DELETE FROM session WHERE key = 'current'").run();
  });

  // ── Debug ───────────────────────────────────────────────────────
  ipcMain.handle('debug:db-stats', () => {
    const tickets = db.prepare("SELECT COUNT(*) as c FROM tickets").get() as any;
    const offices = db.prepare("SELECT COUNT(*) as c FROM offices").get() as any;
    const depts = db.prepare("SELECT COUNT(*) as c FROM departments").get() as any;
    const svcs = db.prepare("SELECT COUNT(*) as c FROM services").get() as any;
    const desks = db.prepare("SELECT COUNT(*) as c FROM desks").get() as any;
    const syncQ = db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL").get() as any;
    const waitingTickets = db.prepare("SELECT ticket_number, office_id, status FROM tickets WHERE status = 'waiting' LIMIT 10").all();
    const allTickets = db.prepare("SELECT ticket_number, office_id, status FROM tickets LIMIT 20").all();
    return {
      tickets: tickets?.c ?? 0,
      offices: offices?.c ?? 0,
      departments: depts?.c ?? 0,
      services: svcs?.c ?? 0,
      desks: desks?.c ?? 0,
      pendingSync: syncQ?.c ?? 0,
      waitingTickets,
      allTickets,
    };
  });

  // ── Connection status ─────────────────────────────────────────────

  ipcMain.handle('connection:status', () => syncEngine?.isOnline ?? false);

  // ── Kiosk Server ────────────────────────────────────────────────

  ipcMain.handle('kiosk:url', () => kioskUrl);
  ipcMain.handle('kiosk:local-ip', () => getLocalIP());

  ipcMain.handle('org:branding', async () => {
    // Try to get org name + logo from Supabase
    try {
      const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      const session = sessionRow ? JSON.parse(sessionRow.value) : null;
      if (!session?.office_ids?.length) return { orgName: null, logoUrl: null };

      const office = db.prepare('SELECT organization_id FROM offices WHERE id = ?').get(session.office_ids[0]) as any;
      if (!office?.organization_id) return { orgName: null, logoUrl: null };

      const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${office.organization_id}&select=name,logo_url`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const orgs = await res.json();
        return { orgName: orgs[0]?.name ?? null, logoUrl: orgs[0]?.logo_url ?? null };
      }
    } catch {}
    return { orgName: null, logoUrl: null };
  });
}

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Init SQLite
  initDB();

  // Setup IPC
  setupIPC();

  // Create window and tray
  createWindow();
  createTray();

  // Start sync engine
  syncEngine = new SyncEngine(
    getDB(),
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    (status) => {
      updateTrayMenu(status);
      mainWindow?.webContents.send('sync:status-change', status);
    },
    (count) => {
      mainWindow?.webContents.send('sync:progress', count);
    },
    () => {
      // Token expired and refresh failed — tell renderer to show re-login
      mainWindow?.webContents.send('auth:session-expired');
    },
    () => {
      notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    }
  );
  syncEngine.start();

  // Start local kiosk server for tablets/touchscreens
  try {
    const kiosk = await startKioskServer(3847);
    kioskUrl = kiosk.url + '/kiosk';
    console.log(`Kiosk available at: ${kioskUrl}`);
  } catch (err) {
    console.error('Failed to start kiosk server:', err);
  }

  // Auto-update check (silent)
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', () => {
    new Notification({
      title: 'QueueFlow Update',
      body: 'A new version is downloading...',
    }).show();
  });
  autoUpdater.on('update-downloaded', () => {
    new Notification({
      title: 'QueueFlow Update Ready',
      body: 'Restart to apply the update.',
    }).show();
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // No update server configured yet — ignore
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', () => {
  syncEngine?.stop();
  stopKioskServer();
  mainWindow?.destroy();
});
