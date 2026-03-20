import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, session as electronSession, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { initDB, getDB, logTicketEvent } from './db';
import { SyncEngine } from './sync';
import { startKioskServer, stopKioskServer, getLocalIP, notifyDisplays, setOnTicketCreated, type SSEEvent } from './kiosk-server';
import { CONFIG } from './config';

// ── Crash handlers — log and keep running ─────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let syncEngine: SyncEngine | null = null;
let kioskUrl: string | null = null;

const { SUPABASE_URL, SUPABASE_ANON_KEY } = CONFIG;

function loadWindowBounds(): { x?: number; y?: number; width: number; height: number } {
  try {
    const db = getDB();
    const row = db.prepare("SELECT value FROM session WHERE key = 'window_bounds'").get() as any;
    if (row) return JSON.parse(row.value);
  } catch {}
  return { width: 1280, height: 800 };
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds() {
  // Debounce: window fires dozens of resize/move events per drag
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow) return;
    try {
      const bounds = mainWindow.getBounds();
      const db = getDB();
      db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('window_bounds', ?)").run(JSON.stringify(bounds));
    } catch {}
  }, 500);
}

function createWindow() {
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: 'Qflo Station',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: true,
    backgroundColor: '#0f172a',
  });

  // Content Security Policy
  const supabaseDomain = new URL(SUPABASE_URL).hostname;
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; ` +
          `script-src 'self' 'unsafe-inline'; ` +
          `style-src 'self' 'unsafe-inline'; ` +
          `img-src 'self' data: https: blob:; ` +
          `connect-src 'self' https://${supabaseDomain} wss://${supabaseDomain} ${CONFIG.CLOUD_URL} http://localhost:*; ` +
          `font-src 'self' data:; ` +
          `media-src 'self' data:;`
        ],
      },
    });
  });

  // Dev or production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    saveWindowBounds();
    // Minimize to tray instead of closing
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('resize', () => saveWindowBounds());
  mainWindow.on('move', () => saveWindowBounds());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use white-on-transparent tray icon (visible on dark taskbars)
  let icon: Electron.NativeImage;
  const candidates = [
    path.join(__dirname, '../assets/tray-icon.png'),
    path.join(app.getAppPath(), 'assets/tray-icon.png'),
    path.join(__dirname, '../assets/icon.png'),
    path.join(app.getAppPath(), 'assets/icon.png'),
  ];
  icon = nativeImage.createEmpty();
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) { icon = img; break; }
    } catch { /* try next */ }
  }
  if (icon.isEmpty()) {
    // Last resort: create a simple white square
    icon = nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 });
  }

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
    { label: `${CONFIG.APP_NAME} v${CONFIG.APP_VERSION}`, enabled: false },
    { type: 'separator' },
    { label: statusLabels[status], enabled: false },
    { type: 'separator' },
    { label: 'Open Station', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`Qflo Station — ${status}`);
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
    // Transaction: ticket insert + sync queue insert are atomic (crash-safe)
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline)
        VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, 1)
      `).run(ticket.id, ticket.ticket_number, ticket.office_id, ticket.department_id, ticket.service_id, ticket.priority ?? 0, JSON.stringify(ticket.customer_data ?? {}), ticket.created_at ?? new Date().toISOString());

      db.prepare(`
        INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
        VALUES (?, 'INSERT', 'tickets', ?, ?, ?)
      `).run(ticket.id + '-create', ticket.id, JSON.stringify(ticket), new Date().toISOString());
    })();

    logTicketEvent(ticket.id, 'created', {
      ticketNumber: ticket.ticket_number,
      toStatus: 'waiting',
      source: 'station_offline',
      details: { officeId: ticket.office_id, departmentId: ticket.department_id, serviceId: ticket.service_id, isOffline: true },
    });

    notifyDisplays({ type: 'ticket_created', ticket_number: ticket.ticket_number, timestamp: new Date().toISOString() });
    mainWindow?.webContents.send('tickets:changed');

    // Immediately push to cloud so web/mobile displays update within 1-2s
    syncEngine?.pushImmediate(ticket.id + '-create');

    return ticket;
  });

  ipcMain.handle('db:update-ticket', (_e, ticketId: string, updates: any) => {
    // Validate ticketId format
    if (typeof ticketId !== 'string' || !ticketId) return null;

    // Whitelist allowed update fields to prevent arbitrary column writes
    const ALLOWED_FIELDS = new Set([
      'status', 'desk_id', 'called_at', 'called_by_staff_id',
      'serving_started_at', 'completed_at', 'cancelled_at', 'parked_at',
      'recall_count', 'notes', 'priority',
    ]);
    const safeUpdates: Record<string, any> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) safeUpdates[key] = val;
    }
    if (Object.keys(safeUpdates).length === 0) return null;

    const sets = Object.entries(safeUpdates)
      .map(([key]) => `${key} = ?`)
      .join(', ');
    const values = Object.values(safeUpdates);

    // ── Capture previous state BEFORE the update for audit trail ──
    const prevTicket = safeUpdates.status
      ? db.prepare('SELECT ticket_number, status FROM tickets WHERE id = ?').get(ticketId) as any
      : null;

    // Transaction: ticket update + sync queue insert are atomic (crash-safe)
    // For manual "Call" button: use atomic CAS to prevent two staff calling same ticket
    if (safeUpdates.status === 'called') {
      const result = db.prepare(
        `UPDATE tickets SET ${sets} WHERE id = ? AND status = 'waiting' RETURNING *`
      ).get(...values, ticketId) as any;
      if (!result) return null; // ticket was already called by someone else
    } else {
      db.prepare(`UPDATE tickets SET ${sets} WHERE id = ?`).run(...values, ticketId);
    }

    // ── Audit log for every status transition and recall ──
    if (safeUpdates.status && prevTicket) {
      logTicketEvent(ticketId, safeUpdates.status === 'waiting' ? 'requeued' : safeUpdates.status, {
        ticketNumber: prevTicket.ticket_number,
        fromStatus: prevTicket.status,
        toStatus: safeUpdates.status,
        source: 'station',
        details: {
          deskId: safeUpdates.desk_id,
          staffId: safeUpdates.called_by_staff_id,
          ...(safeUpdates.notes ? { notes: safeUpdates.notes } : {}),
          ...(safeUpdates.recall_count !== undefined ? { recallCount: safeUpdates.recall_count } : {}),
        },
      });
    } else if (safeUpdates.recall_count !== undefined && !safeUpdates.status) {
      // Recall doesn't change status but is still an important event
      const tk = db.prepare('SELECT ticket_number, status FROM tickets WHERE id = ?').get(ticketId) as any;
      logTicketEvent(ticketId, 'recalled', {
        ticketNumber: tk?.ticket_number,
        fromStatus: tk?.status,
        toStatus: tk?.status,
        source: 'station',
        details: { recallCount: safeUpdates.recall_count },
      });
    }

    const syncId = `${ticketId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
      VALUES (?, 'UPDATE', 'tickets', ?, ?, ?)
    `).run(syncId, ticketId, JSON.stringify(safeUpdates), new Date().toISOString());

    // Immediately push to cloud so web/mobile displays update within 1-2s
    syncEngine?.pushImmediate(syncId);

    // Push typed SSE event based on status change
    if (safeUpdates.status === 'served' || safeUpdates.status === 'no_show') {
      notifyDisplays({ type: 'ticket_served', timestamp: new Date().toISOString() });
    } else if (safeUpdates.status === 'cancelled') {
      notifyDisplays({ type: 'ticket_cancelled', timestamp: new Date().toISOString() });
    } else if (safeUpdates.status === 'called') {
      const dsk = safeUpdates.desk_id ? db.prepare('SELECT name FROM desks WHERE id = ?').get(safeUpdates.desk_id) as any : null;
      const tk = db.prepare('SELECT ticket_number FROM tickets WHERE id = ?').get(ticketId) as any;
      notifyDisplays({ type: 'ticket_called', ticket_number: tk?.ticket_number, desk_name: dsk?.name, timestamp: new Date().toISOString() });
    } else {
      notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    }
    mainWindow?.webContents.send('tickets:changed');
    return { id: ticketId, ...safeUpdates };
  });

  ipcMain.handle('db:query', (_e, table: string, officeIds: string[]) => {
    if (!officeIds?.length || !Array.isArray(officeIds)) return [];
    // Strict whitelist — only allowed tables can be queried
    const placeholders = officeIds.map(() => '?').join(',');
    switch (table) {
      case 'departments':
        return db.prepare(`SELECT id, name, code FROM departments WHERE office_id IN (${placeholders})`).all(...officeIds);
      case 'services':
        return db.prepare(`SELECT id, name, department_id FROM services`).all();
      case 'desks':
        return db.prepare(`SELECT id, name FROM desks WHERE office_id IN (${placeholders})`).all(...officeIds);
      default:
        return [];
    }
  });

  ipcMain.handle('db:call-next', async (_e, officeId: string, deskId: string, staffId: string) => {
    if (!officeId || !deskId || !staffId) return null;
    const now = new Date().toISOString();
    const callTs = Date.now();

    // ── CLOUD PRE-CHECK: verify which tickets are truly still waiting in Supabase ──
    // This prevents calling tickets that were cancelled/resolved remotely by customers
    let cloudWaitingIds: Set<string> | null = null;
    if (syncEngine?.isOnline) {
      try {
        const token = await syncEngine.ensureFreshToken();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/tickets?office_id=eq.${officeId}&status=eq.waiting&select=id`,
          {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(3000),
          }
        );
        if (res.ok) {
          const rows = await res.json();
          cloudWaitingIds = new Set(rows.map((r: any) => r.id));
        }
      } catch {
        // Cloud check failed — proceed with local data (offline-first)
      }
    }

    // ATOMIC: single UPDATE...RETURNING prevents two desks calling the same ticket
    // Transaction wraps both the ticket update and sync queue insert (crash-safe)
    let ticket: any = null;
    let syncId = '';
    let skippedCount = 0;

    db.transaction(() => {
      // Get candidates ordered by priority, then created_at
      const candidates = db.prepare(`
        SELECT id FROM tickets
        WHERE office_id = ? AND status = 'waiting' AND parked_at IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT 10
      `).all(officeId) as any[];

      for (const candidate of candidates) {
        // If cloud check succeeded, skip tickets not confirmed waiting in cloud
        // BUT skip this check for:
        //   - offline-created tickets (not yet synced)
        //   - tickets with pending sync (INSERT not yet pushed)
        //   - tickets created less than 2 minutes ago (sync in progress)
        const ticketInfo = db.prepare("SELECT is_offline, created_at FROM tickets WHERE id = ?").get(candidate.id) as any;
        const hasPendingSync = (db.prepare(
          "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND record_id = ? AND table_name = 'tickets'"
        ).get(candidate.id) as any)?.c > 0;
        const isRecent = ticketInfo?.created_at && (Date.now() - new Date(ticketInfo.created_at).getTime()) < 120_000;

        if (cloudWaitingIds && !cloudWaitingIds.has(candidate.id) && !ticketInfo?.is_offline && !hasPendingSync && !isRecent) {
          // This ticket was cancelled/resolved remotely — mark it locally too
          logTicketEvent(candidate.id, 'auto_cancelled_call_next', {
            fromStatus: 'waiting',
            toStatus: 'cancelled',
            source: 'call_next_cloud_precheck',
            details: { reason: 'not_in_cloud_waiting' },
          });
          db.prepare("UPDATE tickets SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'waiting'")
            .run(now, candidate.id);
          skippedCount++;
          continue;
        }

        // Call this ticket
        ticket = db.prepare(`
          UPDATE tickets
          SET status = 'called', desk_id = ?, called_by_staff_id = ?, called_at = ?
          WHERE id = ? AND status = 'waiting'
          RETURNING *
        `).get(deskId, staffId, now, candidate.id) as any;

        if (ticket) {
          syncId = `${ticket.id}-call-${callTs}`;
          db.prepare(`
            INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
            VALUES (?, 'CALL', 'tickets', ?, ?, ?)
          `).run(syncId, ticket.id, JSON.stringify({ status: 'called', desk_id: deskId, called_by_staff_id: staffId, called_at: now }), now);
          logTicketEvent(ticket.id, 'called', {
            ticketNumber: ticket.ticket_number,
            fromStatus: 'waiting',
            toStatus: 'called',
            source: 'station',
            details: { deskId, staffId },
          });
          break;
        }
      }
    })();

    if (skippedCount > 0) {
      console.log(`[call-next] Skipped ${skippedCount} ticket(s) cancelled remotely`);
    }

    if (!ticket) return null;

    // Immediately push to cloud so web/mobile displays update within 1-2s
    syncEngine?.pushImmediate(syncId);

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
    // pullLatest already fires onDataPulled -> notifyDisplays
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
    // Extract and encrypt password for silent re-auth (never stored in plaintext)
    const pwd = session._pwd;
    delete session._pwd; // never persist plaintext in session JSON

    if (pwd && session.email && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(pwd).toString('base64');
      db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('auth_cred', ?)")
        .run(JSON.stringify({ email: session.email, enc: encrypted }));
      console.log('[auth] Credentials encrypted and stored for silent re-auth');
    }

    db.prepare(`
      INSERT OR REPLACE INTO session (key, value)
      VALUES ('current', ?)
    `).run(JSON.stringify(session));

    // Register Station's local IP in office settings so web kiosk can discover it
    registerStationIP(session);
  });

  ipcMain.handle('session:load', () => {
    const row = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    return row ? JSON.parse(row.value) : null;
  });

  ipcMain.handle('session:clear', () => {
    db.prepare("DELETE FROM session WHERE key = 'current'").run();
    db.prepare("DELETE FROM session WHERE key = 'auth_cred'").run();
    // Stop sync engine on logout to prevent stale token errors
    syncEngine?.stop();
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${office.organization_id}&select=name,logo_url,settings`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const orgs = await res.json();
        const org = orgs[0];
        const settings = org?.settings ?? {};
        return {
          orgName: org?.name ?? null,
          logoUrl: org?.logo_url ?? null,
          brandColor: settings?.brand_color ?? null,
        };
      }
    } catch {}
    return { orgName: null, logoUrl: null, brandColor: null };
  });
}

// ── Register Station IP in Supabase so web kiosk can discover it ─────

async function registerStationIP(session: any) {
  try {
    const ip = getLocalIP();
    const port = CONFIG.KIOSK_PORT;
    const officeIds = session.office_ids?.length ? session.office_ids : [session.office_id];
    if (!officeIds?.length) return;

    const headers: Record<string, string> = {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    };

    for (const officeId of officeIds) {
      // Read current settings
      const res = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/offices?id=eq.${officeId}&select=settings`,
        { headers, signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) continue;
      const offices = await res.json();
      const currentSettings = offices[0]?.settings ?? {};

      // Merge station_ip into settings
      const updated = { ...currentSettings, station_local_url: `http://${ip}:${port}` };
      await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/offices?id=eq.${officeId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ settings: updated }),
          signal: AbortSignal.timeout(5000),
        }
      );
    }
  } catch {
    // Non-critical — web kiosk just won't show as connected
  }
}

// ── Single instance lock — prevent duplicate windows ─────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — quit this one immediately
  app.quit();
} else {
  app.on('second-instance', () => {
    // User launched a second instance — focus the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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
      // Tell renderer to refresh tickets immediately (event-driven, no polling needed)
      mainWindow?.webContents.send('tickets:changed');
    },
    (error) => {
      // Surface sync/reconciliation errors to the Station UI
      mainWindow?.webContents.send('sync:error', error);
    }
  );
  syncEngine.start();

  // Start local kiosk server for tablets/touchscreens
  try {
    const kiosk = await startKioskServer(CONFIG.KIOSK_PORT);
    kioskUrl = kiosk.url + '/kiosk';
    console.log(`Kiosk available at: ${kioskUrl}`);
    // Notify Station UI instantly when a ticket is created from the local kiosk
    // Also push to cloud immediately so QR tracking works remotely
    setOnTicketCreated((syncQueueId: string) => {
      mainWindow?.webContents.send('tickets:changed');
      syncEngine?.pushImmediate(syncQueueId);
    });
  } catch (err) {
    console.error('Failed to start kiosk server:', err);
  }

  // Auto-update check (silent)
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', () => {
    new Notification({
      title: 'Qflo Update',
      body: 'A new version is downloading...',
    }).show();
  });
  autoUpdater.on('update-downloaded', () => {
    new Notification({
      title: 'Qflo Update Ready',
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
