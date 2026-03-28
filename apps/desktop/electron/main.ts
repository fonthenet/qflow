import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, session as electronSession, safeStorage, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { initDB, getDB, generateOfflineTicketNumber, reserveTicketNumber, logTicketEvent, startAutoBackup, stopAutoBackup, backupDatabase } from './db';
import { SyncEngine } from './sync';
import { startKioskServer, stopKioskServer, getLocalIP, notifyDisplays, notifyStationClients, setOnTicketCreated, type SSEEvent } from './kiosk-server';
import { CONFIG } from './config';
import { getMachineId, verifyLicense, getStoredLicense, storeLicense, registerPendingDevice, checkApproval } from './license';
import { normalizeLocale, t as translate, type DesktopLocale } from '../src/lib/i18n';

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
let kioskPort: number | null = null;
let currentLocale: DesktopLocale = 'en';
let updateStatus: {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'no_update' | 'error';
  version: string | null;
  progress: number | null;
  message: string | null;
} = {
  status: 'idle',
  version: null,
  progress: null,
  message: null,
};

const { SUPABASE_URL, SUPABASE_ANON_KEY } = CONFIG;

function emitUpdateStatus() {
  mainWindow?.webContents.send('update:status', updateStatus);
}

function setUpdateStatus(next: Partial<typeof updateStatus>) {
  updateStatus = {
    ...updateStatus,
    ...next,
  };
  emitUpdateStatus();
}

function loadLocale(): DesktopLocale {
  try {
    const db = getDB();
    const row = db.prepare("SELECT value FROM session WHERE key = 'locale'").get() as { value?: string } | undefined;
    return normalizeLocale(row?.value);
  } catch {
    return 'en';
  }
}

function applyLocale(locale: DesktopLocale) {
  currentLocale = locale;
  if (mainWindow) {
    mainWindow.setTitle(translate(currentLocale, 'Qflo Station'));
    mainWindow.webContents.send('settings:locale-changed', currentLocale);
  }
  buildApplicationMenu();
  updateTrayMenu(syncEngine?.isOnline ? 'online' : 'connecting');
}

function persistLocale(locale: DesktopLocale) {
  const db = getDB();
  db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('locale', ?)").run(locale);
}

function buildApplicationMenu() {
  const languageSubmenu = [
    { code: 'en' as DesktopLocale, label: translate(currentLocale, 'English') },
    { code: 'fr' as DesktopLocale, label: translate(currentLocale, 'French') },
    { code: 'ar' as DesktopLocale, label: translate(currentLocale, 'Arabic') },
  ].map((item) => ({
    label: item.label,
    type: 'radio' as const,
    checked: currentLocale === item.code,
    click: () => {
      persistLocale(item.code);
      applyLocale(item.code);
    },
  }));

  const menu = Menu.buildFromTemplate([
    {
      label: translate(currentLocale, 'File'),
      submenu: [
        { label: translate(currentLocale, 'Quit'), click: () => { mainWindow?.destroy(); app.quit(); } },
      ],
    },
    {
      label: translate(currentLocale, 'Edit'),
      submenu: [
        { role: 'undo', label: translate(currentLocale, 'Undo') },
        { role: 'redo', label: translate(currentLocale, 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: translate(currentLocale, 'Cut') },
        { role: 'copy', label: translate(currentLocale, 'Copy') },
        { role: 'paste', label: translate(currentLocale, 'Paste') },
        { role: 'selectAll', label: translate(currentLocale, 'Select All') },
      ],
    },
    {
      label: translate(currentLocale, 'View'),
      submenu: [
        { role: 'reload', label: translate(currentLocale, 'Reload') },
        { role: 'forceReload', label: translate(currentLocale, 'Force Reload') },
        { role: 'toggleDevTools', label: translate(currentLocale, 'Developer Tools') },
        { type: 'separator' },
        { role: 'resetZoom', label: translate(currentLocale, 'Reset Zoom') },
        { role: 'zoomIn', label: translate(currentLocale, 'Zoom In') },
        { role: 'zoomOut', label: translate(currentLocale, 'Zoom Out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: translate(currentLocale, 'Full Screen') },
      ],
    },
    {
      label: translate(currentLocale, 'Window'),
      submenu: [
        { role: 'minimize', label: translate(currentLocale, 'Minimize') },
        { role: 'zoom', label: translate(currentLocale, 'Zoom') },
        { role: 'close', label: translate(currentLocale, 'Close') },
      ],
    },
    {
      label: translate(currentLocale, 'Language'),
      submenu: languageSubmenu,
    },
    {
      label: translate(currentLocale, 'Help'),
      submenu: [
        {
          label: translate(currentLocale, 'About'),
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: translate(currentLocale, 'About Qflo Station'),
              message: translate(currentLocale, 'Qflo Station'),
              detail: `${translate(currentLocale, 'Version')} ${CONFIG.APP_VERSION}`,
            });
          },
        },
        { type: 'separator' },
        {
          label: translate(currentLocale, 'Check for Updates'),
          click: () => autoUpdater.checkForUpdates(),
        },
        {
          label: translate(currentLocale, 'Open Station'),
          click: () => {
            mainWindow?.show();
            mainWindow?.focus();
          },
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

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
  currentLocale = loadLocale();
  buildApplicationMenu();
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    center: true,
    minWidth: 900,
    minHeight: 600,
    title: translate(currentLocale, 'Qflo Station'),
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
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

  // Ensure window is visible and centered on screen after loading
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Safety fallback — force show after 3 seconds no matter what
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.center();
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  mainWindow.on('close', (e) => {
    saveWindowBounds();
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
    online: `● ${translate(currentLocale, 'Online - Connected to cloud')}`,
    offline: `○ ${translate(currentLocale, 'Offline - Using local data')}`,
    syncing: `↻ ${translate(currentLocale, 'Syncing...')}`,
    connecting: `… ${translate(currentLocale, 'Connecting...')}`,
  };

  const menu = Menu.buildFromTemplate([
    { label: `${CONFIG.APP_NAME} v${CONFIG.APP_VERSION}`, enabled: false },
    { type: 'separator' },
    { label: statusLabels[status], enabled: false },
    { type: 'separator' },
    { label: translate(currentLocale, 'Open Station'), click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: translate(currentLocale, 'Check for Updates'), click: () => autoUpdater.checkForUpdates() },
    { type: 'separator' },
    { label: translate(currentLocale, 'Quit'), click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(`${translate(currentLocale, 'Qflo Station')} - ${translate(currentLocale, status === 'online' ? 'Connected' : status === 'offline' ? 'Offline Mode' : status === 'syncing' ? 'Syncing...' : 'Connecting...')}`);
}

function shutdownDesktopRuntime() {
  syncEngine?.stop();
  stopAutoBackup();
  stopKioskServer();
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // ignore tray cleanup errors during shutdown
    }
    tray = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch {
      // ignore window cleanup errors during shutdown
    }
  }
  mainWindow = null;
}

function getSessionScopedKioskUrl() {
  if (!kioskUrl) return null;

  try {
    const db = getDB();
    const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    const officeId =
      typeof session?.office_id === 'string' && session.office_id.length > 0
        ? session.office_id
        : Array.isArray(session?.office_ids) && typeof session.office_ids[0] === 'string'
          ? session.office_ids[0]
          : null;

    if (!officeId) return kioskUrl;

    const scopedUrl = new URL(kioskUrl);
    scopedUrl.searchParams.set('officeId', officeId);
    return scopedUrl.toString();
  } catch {
    return kioskUrl;
  }
}

function getOfficePublicToken(office: { id?: string | null }) {
  const rawId = typeof office.id === 'string' ? office.id.replace(/-/g, '') : '';
  return rawId.slice(0, 16);
}

async function getSessionScopedPublicLinks() {
  try {
    const db = getDB();
    const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    const officeId =
      typeof session?.office_id === 'string' && session.office_id.length > 0
        ? session.office_id
        : Array.isArray(session?.office_ids) && typeof session.office_ids[0] === 'string'
          ? session.office_ids[0]
          : null;

    if (!officeId) return { kioskUrl: null, displayUrl: null };

    const office = db
      .prepare('SELECT id, name, settings FROM offices WHERE id = ? LIMIT 1')
      .get(officeId) as { id?: string; name?: string; settings?: unknown } | undefined;

    if (!office?.name) return { kioskUrl: null, displayUrl: null };

    const kioskUrl = `${CONFIG.CLOUD_URL}/k/${getOfficePublicToken(office)}`;
    let displayUrl: string | null = null;

    try {
      const authToken =
        typeof session?.access_token === 'string' && session.access_token.length > 0
          ? session.access_token
          : SUPABASE_ANON_KEY;
      const headers: Record<string, string> = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${authToken}`,
      };
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/display_screens?office_id=eq.${officeId}&is_active=is.true&select=screen_token&order=created_at.desc&limit=1`,
        {
          headers,
          signal: AbortSignal.timeout(5000),
        }
      );

      if (response.ok) {
        const screens = await response.json();
        const token = screens?.[0]?.screen_token;
        if (typeof token === 'string' && token.length > 0) {
          displayUrl = `${CONFIG.CLOUD_URL}/d/${token}`;
        }
      }
    } catch {
      // Public display link is optional when cloud metadata is unavailable.
    }

    return { kioskUrl, displayUrl };
  } catch {
    return { kioskUrl: null, displayUrl: null };
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────

function setupIPC() {
  const db = getDB();

  // Get connection config
  ipcMain.handle('get-config', () => ({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    APP_VERSION: CONFIG.APP_VERSION,
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

  ipcMain.handle('db:create-ticket', async (_e, ticket: any) => {
    // Auto-generate ticket number if not provided (for in-house bookings)
    if (!ticket.ticket_number) {
      const dept = db.prepare('SELECT code FROM departments WHERE id = ?').get(ticket.department_id) as any;
      const deptCode = dept?.code || 'G';
      const isOnline = syncEngine?.isOnline ?? false;
      const reserved = await reserveTicketNumber(
        CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
        ticket.office_id, ticket.department_id, deptCode, isOnline, db,
      );
      ticket.ticket_number = reserved.ticketNumber;
      ticket.daily_sequence = reserved.dailySequence;
      ticket.is_offline = reserved.isOffline;
    }

    // Generate qr_token if not provided (needed by Supabase NOT NULL constraint)
    if (!ticket.qr_token) {
      const { randomUUID } = require('crypto');
      ticket.qr_token = randomUUID().replace(/-/g, '').slice(0, 12);
    }

    // Generate daily_sequence if not provided (needed by Supabase NOT NULL constraint)
    if (!ticket.daily_sequence) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const seqRow = db.prepare(
        "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND department_id = ? AND created_at >= ?"
      ).get(ticket.office_id, ticket.department_id, todayStart.toISOString()) as any;
      ticket.daily_sequence = (seqRow?.c ?? 0) + 1;
    }

    const now = ticket.created_at ?? new Date().toISOString();

    // Transaction: ticket insert + sync queue insert are atomic (crash-safe)
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline, source, daily_sequence)
        VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?)
      `).run(ticket.id, ticket.ticket_number, ticket.office_id, ticket.department_id, ticket.service_id, ticket.priority ?? 0, JSON.stringify(ticket.customer_data ?? {}), now, ticket.is_offline ? 1 : 0, ticket.source ?? 'walk_in', ticket.daily_sequence);

      // Build clean sync payload with all Supabase NOT NULL fields
      const syncPayload = {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        office_id: ticket.office_id,
        department_id: ticket.department_id,
        service_id: ticket.service_id || null,
        status: 'waiting',
        priority: ticket.priority ?? 0,
        customer_data: ticket.customer_data ?? {},
        created_at: now,
        qr_token: ticket.qr_token,
        daily_sequence: ticket.daily_sequence,
        source: ticket.source ?? 'walk_in',
      };

      db.prepare(`
        INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
        VALUES (?, 'INSERT', 'tickets', ?, ?, ?)
      `).run(ticket.id + '-create', ticket.id, JSON.stringify(syncPayload), now);
    })();

    logTicketEvent(ticket.id, 'created', {
      ticketNumber: ticket.ticket_number,
      toStatus: 'waiting',
      source: ticket.source ?? 'station_offline',
      details: { officeId: ticket.office_id, departmentId: ticket.department_id, serviceId: ticket.service_id, isOffline: true },
    });

    notifyDisplays({ type: 'ticket_created', ticket_number: ticket.ticket_number, timestamp: new Date().toISOString() });
    mainWindow?.webContents.send('tickets:changed');
    notifyStationClients({ type: 'tickets_changed' });

    // Immediately push to cloud so web/mobile displays update within 1-2s
    syncEngine?.pushImmediate(ticket.id + '-create');

    // Auto-create WhatsApp notification session if customer has a phone number
    // (skip if source is whatsapp/messenger — those create sessions via messaging flow)
    const ticketSource = ticket.source ?? 'walk_in';
    if (ticketSource !== 'whatsapp' && ticketSource !== 'messenger') {
      let cd: Record<string, any> = {};
      try { cd = typeof ticket.customer_data === 'string' ? JSON.parse(ticket.customer_data) : (ticket.customer_data ?? {}); } catch { /* empty */ }
      const rawPhone = typeof cd.phone === 'string' ? cd.phone.trim() : null;
      if (rawPhone && syncEngine?.isOnline) {
        const officeRow = db.prepare('SELECT organization_id, timezone, settings FROM offices WHERE id = ?').get(ticket.office_id) as any;
        const orgId = officeRow?.organization_id;
        const tz = officeRow?.timezone;
        let officeCC: string | null = null;
        try { const s = JSON.parse(officeRow?.settings || '{}'); officeCC = s.country_code || null; } catch { /* empty */ }
        // Normalize local phone format
        const TZ_COUNTRY: Record<string, string> = {
          'Africa/Algiers': '213', 'Africa/Tunis': '216', 'Africa/Casablanca': '212',
          'Africa/Cairo': '20', 'Europe/Paris': '33', 'Europe/London': '44',
          'America/New_York': '1', 'America/Chicago': '1', 'America/Denver': '1',
          'America/Los_Angeles': '1', 'America/Toronto': '1',
          'Asia/Riyadh': '966', 'Asia/Dubai': '971', 'Asia/Beirut': '961',
        };
        const ISO_DIAL: Record<string, string> = {
          DZ: '213', TN: '216', MA: '212', EG: '20', FR: '33', GB: '44',
          US: '1', CA: '1', SA: '966', AE: '971', LB: '961',
          TR: '90', DE: '49', ES: '34', IT: '39', BE: '32', NL: '31',
        };
        const dialCode = (officeCC && ISO_DIAL[officeCC.toUpperCase()]) || (tz && TZ_COUNTRY[tz]) || null;
        let phone = rawPhone.replace(/[^\d]/g, '');
        if (phone.startsWith('0') && dialCode) {
          phone = dialCode + phone.slice(1);
        } else if (phone.length === 10 && !phone.startsWith('0') && !phone.startsWith('1') && dialCode === '1') {
          // US/Canada 10-digit local → prepend 1
          phone = '1' + phone;
        }
        if (orgId && phone.length >= 7) {
          syncEngine.ensureFreshToken().then((token: string) => {
            fetch(`${SUPABASE_URL}/rest/v1/whatsapp_sessions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'apikey': SUPABASE_ANON_KEY,
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({
                organization_id: orgId,
                ticket_id: ticket.id,
                office_id: ticket.office_id,
                department_id: ticket.department_id,
                service_id: ticket.service_id || null,
                whatsapp_phone: phone,
                channel: 'whatsapp',
                state: 'active',
                locale: 'fr',
              }),
            }).catch(() => {});
          }).catch(() => {});
        }
      }
    }

    return { ...ticket, qr_token: ticket.qr_token };
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
    notifyStationClients({ type: 'tickets_changed' });
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

  // ── Ban customer ─────────────────────────────────────────────────
  ipcMain.handle('db:ban-customer', async (_e, ticketId: string, reason?: string) => {
    if (!ticketId) return { error: 'Missing ticketId' };

    const ticket = db.prepare('SELECT id, customer_data FROM tickets WHERE id = ?').get(ticketId) as any;
    if (!ticket) return { error: 'Ticket not found' };

    let cd: Record<string, any> = {};
    try { cd = JSON.parse(ticket.customer_data || '{}'); } catch { /* empty */ }

    const phone = cd.phone || null;
    const email = cd.email || null;
    const psid = cd.messenger_psid || null;
    const name = cd.name || null;

    if (!phone && !email && !psid) {
      return { error: 'No identifiable info on this ticket' };
    }

    // Get organization_id from local offices table
    const officeRow = db.prepare('SELECT organization_id FROM offices LIMIT 1').get() as any;
    const orgId = officeRow?.organization_id;
    if (!orgId) return { error: 'Organization not found' };

    // Push ban to cloud
    if (syncEngine?.isOnline) {
      try {
        const token = await syncEngine.ensureFreshToken();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/banned_customers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            organization_id: orgId,
            phone,
            email,
            messenger_psid: psid,
            customer_name: name,
            reason: reason || null,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          if (err.includes('23505')) return { error: 'Customer is already banned' };
          return { error: `Failed to ban: ${res.status}` };
        }
      } catch (err: any) {
        return { error: err?.message ?? 'Network error' };
      }
    } else {
      return { error: 'Cannot ban while offline' };
    }

    return { data: true, name: name || phone || psid || email };
  });

  // ── Sync Status ───────────────────────────────────────────────────

  ipcMain.handle('sync:status', () => ({
    isOnline: syncEngine?.isOnline ?? false,
    pendingCount: syncEngine?.pendingCount ?? 0,
    lastSyncAt: syncEngine?.lastSyncAt ?? null,
    connectionQuality: syncEngine?.connectionQuality ?? 'offline',
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
    notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    notifyStationClients({ type: 'session_changed' });
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
    notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    notifyStationClients({ type: 'session_cleared' });
  });

  ipcMain.handle('settings:get-locale', () => loadLocale());
  ipcMain.handle('settings:set-locale', (_e, locale: string) => {
    const nextLocale = normalizeLocale(locale);
    persistLocale(nextLocale);
    applyLocale(nextLocale);
    return nextLocale;
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

  // ── Activity log ─────────────────────────────────────────────────

  ipcMain.handle('activity:get-recent', (_e, officeId: string, limit = 20) => {
    try {
      // Get the latest event per ticket (final status only), ordered by most recent
      const rows = db.prepare(`
        SELECT a.ticket_number, a.event_type, a.to_status, a.created_at, a.details
        FROM ticket_audit_log a
        INNER JOIN (
          SELECT ticket_id, MAX(created_at) as max_created
          FROM ticket_audit_log
          WHERE created_at >= datetime('now', '-24 hours')
          GROUP BY ticket_id
        ) latest ON a.ticket_id = latest.ticket_id AND a.created_at = latest.max_created
        ORDER BY a.created_at DESC
        LIMIT ?
      `).all(limit) as any[];
      return rows.map((r: any) => ({
        ticket: r.ticket_number || '?',
        action: r.to_status || r.event_type || 'unknown',
        time: r.created_at,
      }));
    } catch { return []; }
  });

  // ── Connection status ─────────────────────────────────────────────

  ipcMain.handle('connection:status', () => syncEngine?.isOnline ?? false);
  ipcMain.handle('kiosk:get-port', () => kioskPort);

  // ── Auto updater ──────────────────────────────────────────────────

  ipcMain.handle('update:get-status', () => updateStatus);
  ipcMain.handle('update:check', async () => {
    try {
      setUpdateStatus({
        status: 'checking',
        message: translate(currentLocale, 'Checking for updates...'),
        progress: null,
      });
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error: any) {
      const message = error?.message || 'Failed to check for updates';
      setUpdateStatus({
        status: 'error',
        message,
        progress: null,
      });
      return { ok: false, error: message };
    }
  });
  ipcMain.handle('update:install', () => {
    if (updateStatus.status !== 'downloaded') {
      return { ok: false, error: 'No update ready to install' };
    }
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  });

  // ── Kiosk Server ────────────────────────────────────────────────

  ipcMain.handle('kiosk:url', () => getSessionScopedKioskUrl());
  ipcMain.handle('kiosk:local-ip', () => getLocalIP());
  ipcMain.handle('links:public', () => getSessionScopedPublicLinks());

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
          messengerPageId: settings?.messenger_enabled && settings?.messenger_page_id
            ? String(settings.messenger_page_id) : null,
        };
      }
    } catch {}
    return { orgName: null, logoUrl: null, brandColor: null, messengerPageId: null };
  });

  // ── License ──────────────────────────────────────────────────────

  ipcMain.handle('license:machine-id', () => getMachineId());

  ipcMain.handle('license:status', async () => {
    const stored = getStoredLicense(db);
    const machineId = getMachineId();
    if (!stored) {
      // Auto-register as pending device so super admin can see it
      registerPendingDevice(machineId).catch(() => {});
      return { licensed: false, machineId };
    }
    if (stored.machineId !== machineId) return { licensed: false, machineId, error: 'Machine changed' };
    return { licensed: true, machineId, key: stored.key };
  });

  // Poll for remote approval — super admin approved this device
  ipcMain.handle('license:check-approval', async () => {
    const machineId = getMachineId();
    const result = await checkApproval(machineId);
    if (result.approved && result.licenseKey) {
      // Auto-store the license locally
      storeLicense(db, result.licenseKey, machineId);
      return { approved: true, key: result.licenseKey };
    }
    return { approved: false };
  });

  ipcMain.handle('license:activate', async (_e, key: string) => {
    const machineId = getMachineId();
    const result = await verifyLicense(key.trim().toUpperCase(), machineId);
    if (result.valid) {
      storeLicense(db, key.trim().toUpperCase(), machineId);
      return { success: true, org: result.org };
    }
    return { success: false, error: result.error };
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

  // Start automatic database backups (daily, keeps last 7)
  startAutoBackup();

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
      notifyStationClients({ type: 'tickets_changed' });
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
    kioskPort = kiosk.port;
    console.log(`Kiosk available at: ${kioskUrl}`);
    // Notify Station UI instantly when a ticket is created from the local kiosk
    // Also push to cloud immediately so QR tracking works remotely
    setOnTicketCreated((syncQueueId: string) => {
      mainWindow?.webContents.send('tickets:changed');
      notifyStationClients({ type: 'tickets_changed' });
      syncEngine?.pushImmediate(syncQueueId);
    });
  } catch (err) {
    console.error('Failed to start kiosk server:', err);
  }

  // Auto-update check (silent)
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({
      status: 'checking',
      message: translate(currentLocale, 'Checking for updates...'),
      version: null,
      progress: null,
    });
  });
  autoUpdater.on('update-available', (info) => {
    setUpdateStatus({
      status: 'available',
      version: info.version,
      progress: 0,
      message: translate(currentLocale, 'A new version is downloading...'),
    });
    new Notification({
      title: translate(currentLocale, 'Qflo Update'),
      body: translate(currentLocale, 'A new version is downloading...'),
    }).show();
  });
  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      status: 'downloading',
      progress: Math.round(progress.percent),
      message: translate(currentLocale, 'Downloading update ({progress}%)', { progress: Math.round(progress.percent) }),
    });
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({
      status: 'no_update',
      version: CONFIG.APP_VERSION,
      progress: null,
      message: translate(currentLocale, 'Qflo Station is up to date.'),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({
      status: 'downloaded',
      version: info.version,
      progress: 100,
      message: translate(currentLocale, 'Restart to apply the update.'),
    });
    new Notification({
      title: translate(currentLocale, 'Qflo Update Ready'),
      body: translate(currentLocale, 'Restart to apply the update.'),
    }).show();
  });
  autoUpdater.on('error', (error) => {
    setUpdateStatus({
      status: 'error',
      progress: null,
      message: error?.message || translate(currentLocale, 'Update check failed'),
    });
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch {
    setUpdateStatus({
      status: 'idle',
      progress: null,
      message: null,
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', async (e) => {
  if ((app as any).isQuitting) return; // already flushing — let quit proceed
  (app as any).isQuitting = true;

  // Graceful shutdown: flush pending sync items before quitting
  if (syncEngine?.isOnline) {
    e.preventDefault(); // hold quit until flush completes
    try {
      await syncEngine.stopGraceful(5000);
    } catch { /* don't block quit on errors */ }
  }

  shutdownDesktopRuntime();
  app.quit(); // re-trigger quit after flush
});

app.on('will-quit', () => {
  shutdownDesktopRuntime();
});
