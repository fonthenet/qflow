import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, session as electronSession, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { initSentry } from './sentry';
import { logger } from './logger';
import { initDB, getDB, closeDB, generateOfflineTicketNumber, reserveTicketNumber, logTicketEvent, startAutoBackup, stopAutoBackup, backupDatabase } from './db';
import { SyncEngine } from './sync';
import { startKioskServer, stopKioskServer, startDiscoveryBroadcast, getLocalIP, notifyDisplays, notifyStationClients, setOnTicketCreated, setSyncStatusGetter, setOnForceSync, setAuthTokenGetter, type SSEEvent } from './kiosk-server';
import { CONFIG } from './config';

// ── Auto-update state (module-level for access from menu/IPC/update handlers) ──
let isManualCheck = false;
let dismissedVersion: string | null = null;
const updateStateFile = path.join(app.getPath('userData'), 'update-state.json');
try {
  const raw = fs.readFileSync(updateStateFile, 'utf-8');
  const state = JSON.parse(raw);
  dismissedVersion = state.dismissedVersion || null;
  if (state.dismissedAt && Date.now() - state.dismissedAt > 24 * 60 * 60 * 1000) {
    dismissedVersion = null;
  }
} catch { /* no state file yet */ }
function dismissVersion(version: string) {
  dismissedVersion = version;
  try { fs.writeFileSync(updateStateFile, JSON.stringify({ dismissedVersion: version, dismissedAt: Date.now() })); } catch { /* ignore */ }
}
function clearDismissed() {
  dismissedVersion = null;
  try { fs.unlinkSync(updateStateFile); } catch { /* ignore */ }
}
import { getMachineId, verifyLicense, getStoredLicense, storeLicense, registerPendingDevice, checkApproval } from './license';
import { normalizeLocale, t as translate, type DesktopLocale } from '../src/lib/i18n';
import { isValidTransition } from '@qflo/shared';

// ── Initialize Sentry as early as possible ──────────────────────────
initSentry();

// ── Force French (Algeria) locale for native inputs (date pickers, etc.) ─
app.commandLine.appendSwitch('lang', 'fr-FR');

// ── Crash handlers — log and keep running ─────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('process', 'Uncaught exception', { error: err?.message, stack: err?.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled rejection', { reason: String(reason) });
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
    if (row?.value) return normalizeLocale(row.value);
  } catch {}
  // First launch: auto-detect from Windows system language
  return normalizeLocale(app.getLocale());
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
        {
          label: translate(currentLocale, 'Settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => { mainWindow?.webContents.send('menu:open-settings'); mainWindow?.show(); mainWindow?.focus(); },
        },
        { type: 'separator' },
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
          label: translate(currentLocale, 'Remote Support'),
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: translate(currentLocale, 'Remote Support'),
              message: 'RustDesk',
              detail: translate(currentLocale, 'Use the Remote Support section in the sidebar to start a RustDesk session.'),
            });
          },
        },
        { type: 'separator' },
        {
          label: translate(currentLocale, 'Check for Updates'),
          click: () => { isManualCheck = true; clearDismissed(); autoUpdater.checkForUpdates(); },
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

  // Intercept window.open() — open kiosk/display links in a fullscreen frameless window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.startsWith('192.168.');
      const isKioskOrDisplay = /\/(kiosk|display)(\/|$|\?)/.test(parsed.pathname);
      if (isLocal && isKioskOrDisplay) {
        const kioskWin = new BrowserWindow({
          width: 1024,
          height: 900,
          backgroundColor: '#ffffff',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        kioskWin.loadURL(url);
        return { action: 'deny' }; // we handle it ourselves
      }
    } catch { /* not a valid URL, fall through */ }
    // For non-kiosk URLs, open in default browser
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

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
    { label: translate(currentLocale, 'Check for Updates'), click: () => { isManualCheck = true; clearDismissed(); autoUpdater.checkForUpdates(); } },
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
  // Close DB gracefully — checkpoint WAL so data survives taskkill during updates
  closeDB();
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

    const officeToken = getOfficePublicToken(office);
    const kioskUrl = `${CONFIG.CLOUD_URL}/k/${officeToken}`;
    const displayUrl = `${CONFIG.CLOUD_URL}/d/${officeToken}`;

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

  ipcMain.handle('db:get-tickets', (_e, officeIdOrIds?: string | string[], statuses?: string[]) => {
    const ids = Array.isArray(officeIdOrIds) ? officeIdOrIds : officeIdOrIds ? [officeIdOrIds] : [];
    const sts = Array.isArray(statuses) ? statuses : [];
    if (!ids.length || !sts.length) return [];
    const officePlaceholders = ids.map(() => '?').join(',');
    const statusPlaceholders = sts.map(() => '?').join(',');
    // NEVER filter active tickets by date — if it's waiting, show it
    const result = db.prepare(
      `SELECT * FROM tickets WHERE office_id IN (${officePlaceholders}) AND status IN (${statusPlaceholders})
       ORDER BY priority DESC, created_at ASC`
    ).all(...ids, ...sts);

    return result;
  });

  ipcMain.handle('db:create-ticket', async (_e, ticket: any) => {
    // Prevent duplicate tickets for the same appointment
    if (ticket.appointment_id) {
      const existing = db.prepare(
        "SELECT id, ticket_number FROM tickets WHERE appointment_id = ? AND status NOT IN ('cancelled', 'no_show') LIMIT 1"
      ).get(ticket.appointment_id) as any;
      if (existing) {
        logger.warn('ipc', `Duplicate check-in blocked: appointment ${ticket.appointment_id} already has ticket ${existing.ticket_number}`);
        return { id: existing.id, ticket_number: existing.ticket_number, duplicate: true };
      }
    }

    // Auto-generate ticket number if not provided (for in-house bookings)
    if (!ticket.ticket_number) {
      const dept = db.prepare('SELECT code FROM departments WHERE id = ?').get(ticket.department_id) as any;
      const deptCode = dept?.code || 'G';
      const isOnline = syncEngine?.isOnline ?? false;
      // Use a fresh JWT for the RPC call (anon key gets rejected by RLS)
      let authToken: string | undefined;
      try { authToken = await syncEngine?.ensureFreshToken(); } catch { /* use anon key fallback */ }
      const reserved = await reserveTicketNumber(
        CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
        ticket.office_id, ticket.department_id, deptCode, isOnline, db,
        authToken,
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

    // Generate daily_sequence if not provided (monotonic per dept — never resets)
    if (!ticket.daily_sequence) {
      const seqRow = db.prepare(
        "SELECT COALESCE(MAX(daily_sequence), 0) as m FROM tickets WHERE department_id = ?"
      ).get(ticket.department_id) as any;
      ticket.daily_sequence = (seqRow?.m ?? 0) + 1;
    }

    const now = ticket.created_at ?? new Date().toISOString();

    // Resolve customer locale: explicit > linked appointment > null.
    // This ensures lifecycle messages (joined/called/served/...) follow the
    // language the customer originally booked in, not the Station UI locale.
    let resolvedLocale: string | null = null;
    const allowedLocales = new Set(['ar', 'en', 'fr']);
    if (typeof ticket.locale === 'string' && allowedLocales.has(ticket.locale)) {
      resolvedLocale = ticket.locale;
    } else if (ticket.appointment_id && syncEngine?.isOnline) {
      try {
        const tok = await syncEngine.ensureFreshToken();
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/appointments?id=eq.${encodeURIComponent(ticket.appointment_id)}&select=locale`,
          { headers: { Authorization: `Bearer ${tok}`, apikey: SUPABASE_ANON_KEY } },
        );
        if (r.ok) {
          const rows = await r.json().catch(() => []);
          const apptLoc = rows?.[0]?.locale;
          if (typeof apptLoc === 'string' && allowedLocales.has(apptLoc)) {
            resolvedLocale = apptLoc;
          }
        }
      } catch (e) {
        logger.warn('ipc', 'Failed to fetch appointment locale', { error: (e as any)?.message });
      }
    }
    ticket.locale = resolvedLocale;

    // Unify notes: extract customer_data.reason into tickets.notes (single source of truth)
    const ticketNotes = (ticket.customer_data?.reason ?? ticket.customer_data?.reason_of_visit ?? ticket.customer_data?.notes ?? ticket.notes ?? '').trim() || null;

    // Transaction: ticket insert + sync queue insert are atomic (crash-safe)
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline, source, daily_sequence, appointment_id, locale, notes)
        VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ticket.id, ticket.ticket_number, ticket.office_id, ticket.department_id, ticket.service_id, ticket.priority ?? 0, JSON.stringify(ticket.customer_data ?? {}), now, ticket.is_offline ? 1 : 0, ticket.source ?? 'walk_in', ticket.daily_sequence, ticket.appointment_id ?? null, resolvedLocale, ticketNotes);

      // Build clean sync payload with all Supabase NOT NULL fields
      const syncPayload: Record<string, any> = {
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
      if (ticket.appointment_id) syncPayload.appointment_id = ticket.appointment_id;
      if (resolvedLocale) syncPayload.locale = resolvedLocale;
      if (ticketNotes) syncPayload.notes = ticketNotes;

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
    let whatsappStatus: { sent: boolean; error?: string } | undefined;
    const ticketSource = ticket.source ?? 'walk_in';
    if (ticketSource !== 'whatsapp' && ticketSource !== 'messenger') {
      let cd: Record<string, any> = {};
      try { cd = typeof ticket.customer_data === 'string' ? JSON.parse(ticket.customer_data) : (ticket.customer_data ?? {}); } catch { /* empty */ }
      const rawPhone = typeof cd.phone === 'string' ? cd.phone.trim() : null;
      if (rawPhone && syncEngine?.isOnline) {
        const officeRow = db.prepare('SELECT name, organization_id, timezone, settings FROM offices WHERE id = ?').get(ticket.office_id) as any;
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
        }
        // North American numbers: 10 digits starting with 2-9 → prepend 1
        // Works regardless of office country
        if (phone.length === 10 && /^[2-9]/.test(phone)) {
          phone = '1' + phone;
        }
        // Algeria: 9-digit subscriber number without leading 0 (e.g. 551234567)
        if (phone.length === 9 && dialCode === '213') {
          phone = '213' + phone;
        }
        if (orgId && phone.length >= 7) {
          // Create WhatsApp session (fire-and-forget)
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
                locale: resolvedLocale || currentLocale || 'fr',
              }),
            }).catch(() => {});
          }).catch(() => {});

          // Send "joined" WhatsApp notification with feedback
          try {
            const pos = db.prepare(`SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND department_id = ? AND status = 'waiting' AND parked_at IS NULL`).get(ticket.office_id, ticket.department_id) as any;
            const waRes = await fetch(`${SUPABASE_URL}/functions/v1/notify-ticket`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({
                ticketId: ticket.id,
                phone,
                event: 'joined',
                ticketNumber: ticket.ticket_number,
                officeName: officeRow?.name ?? '',
                position: pos?.c ?? 1,
                trackUrl: `${CONFIG.CLOUD_URL}/q/${ticket.qr_token}`,
                locale: resolvedLocale || currentLocale,
              }),
              signal: AbortSignal.timeout(8000),
            });
            const waBody = await waRes.json().catch(() => ({}));
            logger.info('ipc', 'WhatsApp notify response', { status: waRes.status, body: waBody });
            whatsappStatus = waRes.ok && waBody.sent !== false
              ? { sent: true }
              : { sent: false, error: waBody.error || `HTTP ${waRes.status}` };
          } catch (waErr: any) {
            logger.warn('ipc', 'WhatsApp notify failed', { error: waErr?.message });
            whatsappStatus = { sent: false, error: waErr?.message || 'Network error' };
          }

          // Upsert customer record (fire-and-forget) — unified dedup by phone
          syncEngine.ensureFreshToken().then((upsertToken: string) => {
            fetch(`${CONFIG.CLOUD_URL}/api/upsert-customer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upsertToken}` },
              body: JSON.stringify({
                organizationId: orgId,
                name: cd.name || cd.customer_name || null,
                phone: rawPhone,
                email: cd.email || null,
                wilayaCode: cd.wilaya || cd.wilaya_code || null,
                source: 'station',
                timezone: tz || null,
              }),
              signal: AbortSignal.timeout(8000),
            }).then(() => {
              logger.info('ipc', 'Customer upserted from ticket creation');
            }).catch((e: any) => {
              logger.warn('ipc', 'Customer upsert failed (non-fatal)', { error: e?.message });
            });
          }).catch(() => {});
        }
      }
    }

    return { ...ticket, qr_token: ticket.qr_token, whatsappStatus };
  });

  // Insert a ticket returned by the cloud API into local SQLite.
  // No sync_queue entry — the ticket already exists in the cloud.
  ipcMain.handle('db:insert-cloud-ticket', (_e, ticket: any) => {
    if (!ticket?.id || !ticket?.ticket_number) return null;
    try {
      // Skip if already exists locally
      const existing = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticket.id);
      if (existing) return { id: ticket.id, ticket_number: ticket.ticket_number, duplicate: true };

      const now = ticket.created_at ?? new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline, source, daily_sequence, appointment_id, locale, qr_token, checked_in_at, estimated_wait_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticket.id, ticket.ticket_number, ticket.office_id, ticket.department_id,
        ticket.service_id ?? null, ticket.status ?? 'waiting', ticket.priority ?? 0,
        JSON.stringify(ticket.customer_data ?? {}), now,
        ticket.source ?? 'appointment', ticket.daily_sequence ?? 0,
        ticket.appointment_id ?? null, ticket.locale ?? null,
        ticket.qr_token ?? null, ticket.checked_in_at ?? null,
        ticket.estimated_wait_minutes ?? null
      );
      notifyDisplays({ type: 'ticket_created', ticket_number: ticket.ticket_number, timestamp: new Date().toISOString() });
      mainWindow?.webContents.send('tickets:changed');
      notifyStationClients({ type: 'tickets_changed' });
      return { id: ticket.id, ticket_number: ticket.ticket_number };
    } catch (err: any) {
      logger.error('ipc', 'insert-cloud-ticket error', { error: err?.message });
      return null;
    }
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

    // ── Validate status transition ──
    if (safeUpdates.status && prevTicket && !isValidTransition(prevTicket.status, safeUpdates.status)) {
      logger.warn('ipc', 'Invalid transition', { from: prevTicket.status, to: safeUpdates.status, ticketId });
      return null;
    }

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

    // ── Direct API call for instant notification (3-hop path) ──
    // Fire-and-forget: calls /api/ticket-transition which handles
    // WhatsApp/Messenger notification, position reminders, and session cleanup.
    // The sync queue remains as fallback for offline scenarios.
    const isStatusTransition = safeUpdates.status && ['called', 'serving', 'served', 'no_show', 'cancelled'].includes(safeUpdates.status);
    const isRecall = !safeUpdates.status && safeUpdates.recall_count !== undefined;

    if ((isStatusTransition || isRecall) && syncEngine?.isOnline) {
      // Always resolve desk name — either from the update payload or from the ticket's current desk
      let dskName: string | undefined;
      if (safeUpdates.desk_id) {
        dskName = (db.prepare('SELECT name FROM desks WHERE id = ?').get(safeUpdates.desk_id) as any)?.name;
      }
      if (!dskName) {
        // Fallback: look up the desk already assigned to this ticket (e.g. during 'serving' transition)
        const tkDesk = db.prepare('SELECT d.name FROM tickets t JOIN desks d ON d.id = t.desk_id WHERE t.id = ?').get(ticketId) as any;
        dskName = tkDesk?.name;
      }

      syncEngine.ensureFreshToken().then((token: string) => {
        fetch(`${CONFIG.CLOUD_URL}/api/ticket-transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ticketId,
            status: safeUpdates.status || 'called', // recall keeps 'called' status
            deskId: safeUpdates.desk_id,
            deskName: dskName,
            staffId: safeUpdates.called_by_staff_id,
            skipNotification: false,
            ...(safeUpdates.notes !== undefined ? { notes: safeUpdates.notes } : {}),
            ...(isRecall ? { skipStatusUpdate: true, notifyEvent: 'recall' } : {}),
          }),
          signal: AbortSignal.timeout(10000),
        })
          .then(async (res) => {
            const result = await res.json().catch(() => ({}));
            if (result.notified) {
              mainWindow?.webContents.send('notify:result', { ticketId, sent: true, channel: result.channel });
              // Mark sync item so trigger doesn't double-notify
              db.prepare("UPDATE sync_queue SET already_notified = 1 WHERE id = ?").run(syncId);
            } else {
              mainWindow?.webContents.send('notify:result', { ticketId, sent: false, error: result.notifyError || 'not_notified' });
            }
          })
          .catch((err: any) => {
            logger.warn('ticket-transition', 'Direct API call failed, sync will handle', { error: err?.message });
            mainWindow?.webContents.send('notify:result', { ticketId, sent: false, error: 'network_error' });
          });
      }).catch(() => {
        mainWindow?.webContents.send('notify:result', { ticketId, sent: false, error: 'token_error' });
      });
    }

    return { id: ticketId, ...safeUpdates };
  });

  // ── Save notes via direct API (service-role, bypasses RLS) ──────
  ipcMain.handle('db:save-notes', async (_e, ticketId: string, notes: string) => {
    if (!ticketId || typeof ticketId !== 'string') return { error: 'invalid_ticket' };

    // 1. Save locally
    db.prepare('UPDATE tickets SET notes = ? WHERE id = ?').run(notes || null, ticketId);

    // 2. Push to cloud via direct API (reliable, service-role)
    if (syncEngine?.isOnline) {
      try {
        const token = await syncEngine.ensureFreshToken();
        const res = await fetch(`${CONFIG.CLOUD_URL}/api/ticket-transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ticketId, notes: notes || null }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return { ok: true };
        // Fallback to sync queue
      } catch {}
    }

    // 3. Offline fallback: enqueue for sync
    const syncId = `notes-${ticketId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
      VALUES (?, 'UPDATE', 'tickets', ?, ?, ?)
    `).run(syncId, ticketId, JSON.stringify({ notes: notes || null }), new Date().toISOString());
    syncEngine?.pushImmediate(syncId);
    return { ok: true, queued: true };
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
      case 'offices':
        return db.prepare(`SELECT id, name, timezone, settings, operating_hours FROM offices WHERE id IN (${placeholders})`).all(...officeIds);
      default:
        return [];
    }
  });

  ipcMain.handle('db:update-desk', (_e, deskId: string, updates: any) => {
    if (!deskId || !updates || typeof updates !== 'object') return false;
    const allowed = ['status', 'current_staff_id'] as const;
    const cols: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (key in updates) {
        cols.push(`${key} = ?`);
        vals.push(updates[key]);
      }
    }
    if (cols.length === 0) return false;
    db.prepare(`UPDATE desks SET ${cols.join(', ')} WHERE id = ?`).run(...vals, deskId);
    return true;
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
          // This ticket was cancelled/resolved remotely — adopt cloud state locally.
          // We do NOT enqueue a sync_queue row here because the cloud is already
          // the source of truth for this transition. Setting BOTH cancelled_at and
          // completed_at ensures the pull-merge protection at sync.ts:1333 recognizes
          // this as an operator-style cancel (not an auto-cancel) and won't flap
          // the row back to 'waiting' on the next pull if cloud transiently disagrees.
          logTicketEvent(candidate.id, 'auto_cancelled_call_next', {
            fromStatus: 'waiting',
            toStatus: 'cancelled',
            source: 'call_next_cloud_precheck',
            details: { reason: 'not_in_cloud_waiting' },
          });
          db.prepare("UPDATE tickets SET status = 'cancelled', cancelled_at = ?, completed_at = ? WHERE id = ? AND status = 'waiting'")
            .run(now, now, candidate.id);
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
      logger.info('call-next', 'Skipped ticket(s) cancelled remotely', { skippedCount });
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

    // ── Direct API call for instant notification (3-hop path) ──
    if (syncEngine?.isOnline) {
      syncEngine.ensureFreshToken().then((token: string) => {
        fetch(`${CONFIG.CLOUD_URL}/api/ticket-transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ticketId: ticket.id,
            status: 'called',
            deskId,
            deskName: desk?.name,
            staffId,
            skipNotification: false,
          }),
          signal: AbortSignal.timeout(10000),
        })
          .then(async (res) => {
            const result = await res.json().catch(() => ({}));
            if (result.notified) {
              mainWindow?.webContents.send('notify:result', { ticketId: ticket.id, sent: true, channel: result.channel });
              db.prepare("UPDATE sync_queue SET already_notified = 1 WHERE id = ?").run(syncId);
            } else {
              mainWindow?.webContents.send('notify:result', { ticketId: ticket.id, sent: false, error: result.notifyError || 'not_notified' });
            }
          })
          .catch((err: any) => {
            logger.warn('call-next', 'Direct API call failed, sync will handle', { error: err?.message });
            mainWindow?.webContents.send('notify:result', { ticketId: ticket.id, sent: false, error: 'network_error' });
          });
      }).catch(() => {});
    }

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
    // Pure token auth (v1.8.0) — no password storage
    delete session._pwd; // strip if somehow still present

    // Generate a station_token for authenticating HTTP station endpoints
    const stationToken = randomUUID();
    db.prepare(`
      INSERT OR REPLACE INTO session (key, value, station_token)
      VALUES ('current', ?, ?)
    `).run(JSON.stringify(session), stationToken);

    // Clean up any legacy stored credentials from pre-v1.8.0
    try { db.prepare("DELETE FROM session WHERE key = 'auth_cred'").run(); } catch {}

    // Register Station's local IP in office settings so web kiosk can discover it
    registerStationIP(session);
    notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    notifyStationClients({ type: 'session_changed' });
  });

  // Expose station_token to renderer so it can pass it to the station HTML page
  ipcMain.handle('session:get-station-token', () => {
    const row = db.prepare("SELECT station_token FROM session WHERE key = 'current'").get() as any;
    return row?.station_token ?? null;
  });

  ipcMain.handle('session:load', () => {
    const row = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    if (!row) return null;
    return JSON.parse(row.value);
  });

  ipcMain.handle('session:clear', () => {
    db.prepare("DELETE FROM session WHERE key = 'current'").run();
    try { db.prepare("DELETE FROM session WHERE key = 'auth_cred'").run(); } catch {} // clean legacy
    // Stop sync engine on logout to prevent stale token errors
    syncEngine?.stop();
    notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() });
    notifyStationClients({ type: 'session_cleared' });
  });

  // ── Auth token provider (single source of truth) ──────────────
  // Renderer asks main process for a valid token instead of managing
  // its own refresh logic. This eliminates the dual-client token drift.
  ipcMain.handle('auth:get-token', async () => {
    try {
      if (syncEngine) {
        const token = await syncEngine.ensureFreshToken();
        if (token && token !== CONFIG.SUPABASE_ANON_KEY) {
          return { token, ok: true };
        }
      }
      // Fallback: read from DB
      const sdb = getDB();
      const row = sdb.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      if (row) {
        const session = JSON.parse(row.value);
        if (session?.access_token) {
          return { token: session.access_token, ok: true };
        }
      }
      return { token: '', ok: false, error: 'No valid auth token' };
    } catch (err: any) {
      logger.error('auth', 'get-token IPC failed', { error: err?.message });
      return { token: '', ok: false, error: err?.message };
    }
  });

  ipcMain.handle('settings:get-locale', () => loadLocale());
  ipcMain.handle('settings:set-locale', (_e, locale: string) => {
    const nextLocale = normalizeLocale(locale);
    persistLocale(nextLocale);
    applyLocale(nextLocale);
    return nextLocale;
  });

  // ── Google Sheets CSV fetch (bypasses renderer CORS) ──────────
  ipcMain.handle('http:fetch-text', async (_e, url: string) => {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const text = await res.text();
      return { ok: true, status: res.status, text };
    } catch (err: any) {
      return { ok: false, status: 0, error: err?.message || 'Network error' };
    }
  });

  // ── Broadcast templates (local SQLite) ─────────────────────────
  ipcMain.handle('templates:list', () => {
    return db.prepare(
      "SELECT id, title, shortcut, body_fr, body_ar, created_at FROM broadcast_templates ORDER BY created_at DESC"
    ).all();
  });

  ipcMain.handle('templates:save', (_e, title: string, bodyFr: string, bodyAr: string, shortcut: string) => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO broadcast_templates (id, organization_id, title, shortcut, body_fr, body_ar) VALUES (?, 'local', ?, ?, ?, ?)"
    ).run(id, title, shortcut || null, bodyFr || null, bodyAr || null);
    return { id };
  });

  ipcMain.handle('templates:delete', (_e, id: string) => {
    db.prepare("DELETE FROM broadcast_templates WHERE id = ?").run(id);
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

  // ── Ticket timeline for appointment detail ──────────────────────

  ipcMain.handle('ticket:get-timeline', (_e, ticketId: string) => {
    try {
      // Get all events from local audit log for this ticket
      const rows = db.prepare(`
        SELECT event_type, from_status, to_status, source, details, created_at
        FROM ticket_audit_log
        WHERE ticket_id = ?
        ORDER BY created_at ASC
      `).all(ticketId) as any[];

      // Also get ticket timestamps as fallback/supplement
      const ticket = db.prepare(`
        SELECT created_at, called_at, serving_started_at, completed_at, cancelled_at, parked_at, status
        FROM tickets WHERE id = ?
      `).get(ticketId) as any;

      return { events: rows, ticket: ticket ?? null };
    } catch { return { events: [], ticket: null }; }
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
      isManualCheck = true; // bypass dismissal — user explicitly wants to update
      clearDismissed();
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
    // Backup and close DB before installing update to prevent data loss
    backupDatabase();
    closeDB();
    logger.info('update', 'DB backed up and closed — proceeding with quitAndInstall');
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${office.organization_id}&select=name,name_ar,logo_url,settings`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const orgs = await res.json();
        const org = orgs[0];
        const settings = org?.settings ?? {};
        return {
          orgName: org?.name ?? null,
          orgNameAr: org?.name_ar ?? null,
          logoUrl: org?.logo_url ?? null,
          brandColor: settings?.brand_color ?? null,
          messengerPageId: settings?.messenger_enabled && settings?.messenger_page_id
            ? String(settings.messenger_page_id) : null,
          whatsappPhone: CONFIG.WHATSAPP_PHONE || null,
        };
      }
    } catch {}
    return { orgName: null, logoUrl: null, brandColor: null, messengerPageId: null, whatsappPhone: null };
  });

  // ── Remote Support (RustDesk) ────────────────────────────────────

  let rustdeskProcess: any = null;


  // --- Heartbeat: ping cloud every 30s so super admin sees online/offline ---
  function sendHeartbeat() {
    try {
      const db = getDB();
      const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      const session = sessionRow ? JSON.parse(sessionRow.value) : null;
      const https = require('https');
      const payload = JSON.stringify({
        machineId: getMachineId(),
        machineName: require('os').hostname(),
        officeId: session?.office_id ?? session?.office_ids?.[0] ?? null,
        organizationId: session?.organization_id ?? null,
        appVersion: CONFIG.APP_VERSION,
      });
      const url = new URL(`${CONFIG.CLOUD_URL}/api/desktop-status`);
      const req = https.request({
        hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000,
      }, () => {});
      req.on('timeout', () => { req.destroy(); });
      req.on('error', () => {});
      req.end(payload);
    } catch (e: any) {
      logger.warn('heartbeat', 'Error', { error: e?.message });
    }
  }
  const heartbeatInterval = setInterval(sendHeartbeat, 30000);
  sendHeartbeat(); // initial ping

  // --- No-show sweep: mark confirmed appointments past scheduled+1h as no_show ---
  // Runs every 5 minutes. Only touches the office(s) the Station belongs to.
  // Skips appointments that already have a linked ticket (those follow ticket lifecycle).
  async function sweepNoShows() {
    try {
      if (!syncEngine?.isOnline) return;
      const db = getDB();
      const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      const session = sessionRow ? JSON.parse(sessionRow.value) : null;
      const officeId = session?.office_id ?? session?.office_ids?.[0];
      if (!officeId) return;
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const token = await syncEngine.ensureFreshToken();
      // Find confirmed appointments past cutoff for this office
      const findUrl = `${SUPABASE_URL}/rest/v1/appointments?office_id=eq.${officeId}&status=eq.confirmed&scheduled_at=lt.${encodeURIComponent(cutoff)}&select=id`;
      const findRes = await fetch(findUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
      });
      if (!findRes.ok) return;
      const stale = await findRes.json().catch(() => []);
      if (!Array.isArray(stale) || stale.length === 0) return;
      for (const appt of stale) {
        // Call the moderate-appointment API so the customer is notified via
        // their original WhatsApp/Messenger session.
        await fetch(`${CONFIG.CLOUD_URL}/api/moderate-appointment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ appointmentId: appt.id, action: 'no_show' }),
        }).catch(() => {});
      }
      logger.info('no-show-sweep', 'Marked appointment(s) as no_show', { count: stale.length });
    } catch (e: any) {
      logger.warn('no-show-sweep', 'Error', { error: e?.message });
    }
  }
  const noShowInterval = setInterval(sweepNoShows, 5 * 60 * 1000);
  setTimeout(sweepNoShows, 30_000); // initial run after 30s

  // --- RustDesk process watcher: detect when RustDesk exits outside our control ---
  let rustdeskWatcherInterval: ReturnType<typeof setInterval> | null = null;
  function startRustdeskWatcher() {
    if (rustdeskWatcherInterval) return;
    rustdeskWatcherInterval = setInterval(() => {
      require('child_process').exec('tasklist /FI "IMAGENAME eq rustdesk.exe" /NH', { timeout: 5000 }, (err: any, stdout: string) => {
        if (err || !stdout.toLowerCase().includes('rustdesk.exe')) {
          // RustDesk is no longer running — clear session
          logger.info('Support', 'RustDesk process no longer detected — clearing session');
          rustdeskProcess = null;

          reportSupportStatus(null, null, false);
          stopRustdeskWatcher();
        }
      });
    }, 10000);
  }
  function stopRustdeskWatcher() {
    if (rustdeskWatcherInterval) { clearInterval(rustdeskWatcherInterval); rustdeskWatcherInterval = null; }
  }

  // Register cleanup for quit handlers
  cleanupSupport = () => {
    clearInterval(heartbeatInterval);
    stopRustdeskWatcher();
    reportSupportStatus(null, null, false);
  };

  function reportSupportStatus(rustdeskId: string | null, rustdeskPassword: string | null, active: boolean) {
    try {
      const db = getDB();
      const sessionRow = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      const session = sessionRow ? JSON.parse(sessionRow.value) : null;
      const https = require('https');
      const payload = JSON.stringify({
        machineId: getMachineId(),
        machineName: require('os').hostname(),
        officeId: session?.office_id ?? session?.office_ids?.[0] ?? null,
        organizationId: session?.organization_id ?? null,
        appVersion: CONFIG.APP_VERSION,
        rustdeskId: rustdeskId,
        rustdeskPassword: rustdeskPassword,
        supportActive: active,
      });
      const url = new URL(`${CONFIG.CLOUD_URL}/api/desktop-status`);
      logger.info('Support', 'Reporting to cloud', { url: url.href, action: active ? 'START' : 'STOP' });
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res: any) => {
        let body = '';
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => { logger.info('Support', 'Cloud response', { statusCode: res.statusCode, body }); });
      });
      req.on('error', (err: any) => { logger.error('Support', 'Cloud report error', { error: err.message }); });
      req.end(payload);
    } catch (err: any) { logger.error('Support', 'reportSupportStatus error', { error: err.message }); }
  }

  function getRustDeskDir(): string {
    const path = require('path');
    return path.join(app.getPath('userData'), 'rustdesk');
  }

  function getSystemRustDeskExe(): string | null {
    const path = require('path');
    const fs = require('fs');
    const systemPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'RustDesk', 'rustdesk.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'RustDesk', 'rustdesk.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'RustDesk', 'rustdesk.exe'),
    ];
    return systemPaths.find((p: string) => fs.existsSync(p)) ?? null;
  }

  function getBundledRustDeskExe(): string | null {
    const path = require('path');
    const fs = require('fs');
    const bundled = path.join(getRustDeskDir(), 'rustdesk.exe');
    return fs.existsSync(bundled) ? bundled : null;
  }

  function getRustDeskExe(): string | null {
    // Prefer system-installed over portable
    return getSystemRustDeskExe() ?? getBundledRustDeskExe() ?? null;
  }

  function installRustDesk(portableExe: string): Promise<boolean> {
    return new Promise((resolve) => {
      logger.info('Support', 'Installing RustDesk system-wide...');
      require('child_process').exec(`"${portableExe}" --silent-install`, { timeout: 30000 }, (err: any) => {
        if (err) logger.error('Support', 'RustDesk install error', { error: err.message });
        else logger.info('Support', 'RustDesk installed successfully');
        resolve(!err);
      });
    });
  }

  function getRustDeskId(): Promise<string | null> {
    const exe = getRustDeskExe();
    if (!exe) return Promise.resolve(null);
    return new Promise((resolve) => {
      require('child_process').exec(`"${exe}" --get-id`, { timeout: 5000 }, (err: any, stdout: string) => {
        if (err || !stdout) return resolve(null);
        // RustDesk outputs DLL skip messages before the ID — extract the numeric ID
        const match = stdout.match(/\b(\d{6,})\b/);
        resolve(match ? match[1] : null);
      });
    });
  }

  ipcMain.handle('support:rustdesk-status', async () => {
    const exe = getRustDeskExe();
    const id = await getRustDeskId();
    return {
      installed: !!exe,
      running: !!rustdeskProcess,
      id,
      exe,
    };
  });

  ipcMain.handle('support:rustdesk-start', async () => {
    let exe = getRustDeskExe();
    if (!exe) return { ok: false, error: 'not_installed' };

    try {
      // Auto-install if only portable version exists (fixes UAC warning)
      if (!getSystemRustDeskExe() && getBundledRustDeskExe()) {
        await installRustDesk(getBundledRustDeskExe()!);
        // After install, prefer the system-installed exe
        exe = getSystemRustDeskExe() ?? exe;
      }

      rustdeskProcess = require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' });
      rustdeskProcess.unref();
      rustdeskProcess.on('exit', () => { rustdeskProcess = null; });

      // Wait for RustDesk to start, then get ID
      await new Promise(r => setTimeout(r, 3000));
      const id = await getRustDeskId();

      reportSupportStatus(id, null, true);
      startRustdeskWatcher();

      return { ok: true, id };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('support:rustdesk-stop', () => {
    if (rustdeskProcess) {
      try { rustdeskProcess.kill(); } catch {}
      rustdeskProcess = null;
    }
    // Also try to kill any running RustDesk process
    try { require('child_process').exec('taskkill /F /IM rustdesk.exe 2>nul'); } catch {}
    // Clear support session from cloud
    stopRustdeskWatcher();
    reportSupportStatus(null, null, false);
    return { ok: true };
  });

  ipcMain.handle('support:rustdesk-download', async () => {
    const fs = require('fs');
    const path = require('path');
    const https = require('https');

    const dir = getRustDeskDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const destPath = path.join(dir, 'rustdesk.exe');

    // Download latest portable RustDesk from GitHub releases
    try {
      // Get latest release info
      const releaseInfo: any = await new Promise((resolve, reject) => {
        https.get('https://api.github.com/repos/rustdesk/rustdesk/releases/latest', {
          headers: { 'User-Agent': 'QfloStation' },
        }, (res: any) => {
          let body = '';
          res.on('data', (c: string) => { body += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
          });
        }).on('error', reject);
      });

      // RustDesk only publishes 64-bit Windows builds
      if (process.arch === 'ia32') {
        return { ok: false, error: 'RustDesk is not available for 32-bit Windows. Please use a 64-bit system for remote support.' };
      }

      // Find the portable x86_64 exe
      const asset = (releaseInfo.assets ?? []).find((a: any) =>
        a.name?.match(/rustdesk.*x86_64.*\.exe$/i) && !a.name?.includes('install')
      );

      if (!asset) return { ok: false, error: 'No portable exe found in latest release' };

      // Download with redirect following
      const downloadUrl = asset.browser_download_url;
      mainWindow?.webContents.send('support:download-progress', { percent: 0, status: 'downloading' });

      await new Promise<void>((resolve, reject) => {
        const follow = (url: string, depth = 0) => {
          if (depth > 10) { reject(new Error('Too many redirects')); return; }
          const mod = url.startsWith('https') ? https : require('http');
          mod.get(url, { headers: { 'User-Agent': 'QfloStation' } }, (res: any) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              follow(res.headers.location, depth + 1);
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`Download failed: HTTP ${res.statusCode}`));
              return;
            }
            const total = parseInt(res.headers['content-length'] ?? '0', 10);
            let received = 0;
            const file = fs.createWriteStream(destPath);
            res.on('data', (chunk: Buffer) => {
              received += chunk.length;
              file.write(chunk);
              if (total > 0) {
                mainWindow?.webContents.send('support:download-progress', {
                  percent: Math.round((received / total) * 100),
                  status: 'downloading',
                });
              }
            });
            res.on('end', () => {
              file.end();
              mainWindow?.webContents.send('support:download-progress', { percent: 100, status: 'done' });
              resolve();
            });
            res.on('error', reject);
          }).on('error', reject);
        };
        follow(downloadUrl);
      });

      return { ok: true, path: destPath };
    } catch (err: any) {
      // Clean up partial download
      try { fs.unlinkSync(destPath); } catch {}
      return { ok: false, error: err.message };
    }
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

// Module-level cleanup hook — set from inside whenReady
let cleanupSupport: (() => void) | null = null;

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Init structured logger (purges logs older than 14 days)
  logger.init({ minLevel: app.isPackaged ? 'info' : 'debug' });

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
    },
    (token) => {
      // Token was refreshed by sync engine — broadcast to renderer
      // so its Supabase client gets the new token immediately
      mainWindow?.webContents.send('auth:token-refreshed', token);
    }
  );
  syncEngine.start();

  // ── Startup token validation ──────────────────────────────────────
  // If the session has a stale refresh token (e.g. from pre-v1.8.x),
  // detect it immediately instead of waiting for 5 sync failures.
  (async () => {
    try {
      const sdb = getDB();
      const row = sdb.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      if (!row) return; // No session — Login screen will show
      const session = JSON.parse(row.value);
      if (!session?.refresh_token) return;

      // Quick validate: try to refresh the token once
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        logger.error('startup', 'Refresh token is stale — prompting re-login', {
          code: 'QF-AUTH-001', status: res.status,
        });
        // Small delay to let the renderer mount first
        setTimeout(() => {
          mainWindow?.webContents.send('auth:session-expired');
        }, 3000);
      } else {
        // Token is valid — update session with fresh tokens
        const data = await res.json();
        if (data.access_token) {
          const updated = { ...session, access_token: data.access_token, refresh_token: data.refresh_token ?? session.refresh_token };
          sdb.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('current', ?)").run(JSON.stringify(updated));
          logger.info('startup', 'Startup token validation passed — session refreshed');
        }
      }
    } catch (err: any) {
      logger.warn('startup', 'Startup token validation skipped (network error)', { error: err?.message });
    }
  })();

  // Start local kiosk server for tablets/touchscreens
  try {
    const kiosk = await startKioskServer(CONFIG.KIOSK_PORT);
    kioskUrl = kiosk.url + '/kiosk';
    kioskPort = kiosk.port;
    logger.info('kiosk', `Kiosk available at: ${kioskUrl}`);
    if (kiosk.port !== CONFIG.KIOSK_PORT) {
      logger.warn('Station', 'Default port was in use', { defaultPort: CONFIG.KIOSK_PORT, actualPort: kiosk.port });
      // Notify the Station UI so the operator knows
      mainWindow?.webContents.send('port-changed', {
        requested: CONFIG.KIOSK_PORT,
        actual: kiosk.port,
      });
    }
    // Start UDP discovery so mobile apps can find this Station instantly
    startDiscoveryBroadcast(kiosk.port);
    // Notify Station UI instantly when a ticket is created from the local kiosk
    // Also push to cloud immediately so QR tracking works remotely
    setOnTicketCreated((syncQueueId: string) => {
      mainWindow?.webContents.send('tickets:changed');
      notifyStationClients({ type: 'tickets_changed' });
      syncEngine?.pushImmediate(syncQueueId);
    });
    // Expose auth token getter so kiosk-server can use JWT for RPC calls
    setAuthTokenGetter(async () => {
      try { return await syncEngine?.ensureFreshToken(); } catch { return undefined; }
    });
    // Expose real sync status to kiosk-server HTTP endpoints
    setSyncStatusGetter(() => ({
      isOnline: syncEngine?.isOnline ?? false,
      pendingCount: syncEngine?.pendingCount ?? 0,
      lastSyncAt: syncEngine?.lastSyncAt ?? null,
    }));
    setOnForceSync(async () => {
      await syncEngine?.syncNow();
      await syncEngine?.pullLatest();
    });
  } catch (err) {
    logger.error('kiosk', 'Failed to start kiosk server', { error: (err as Error)?.message });
  }

  // Auto-update check — prompt user before install, backup DB first
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({
      status: 'checking',
      message: translate(currentLocale, 'Checking for updates...'),
      version: null,
      progress: null,
    });
  });
  autoUpdater.on('update-available', (info) => {
    // Skip download if user already dismissed this version (unless manual check)
    if (!isManualCheck && dismissedVersion === info.version) {
      logger.info('update', 'Skipping dismissed version', { version: info.version });
      setUpdateStatus({
        status: 'no_update',
        version: CONFIG.APP_VERSION,
        progress: null,
        message: translate(currentLocale, 'Update {version} available — install from settings.', { version: info.version }),
      });
      return;
    }
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
  autoUpdater.on('update-downloaded', async (info) => {
    setUpdateStatus({
      status: 'downloaded',
      version: info.version,
      progress: 100,
      message: translate(currentLocale, 'Restart to apply the update.'),
    });

    // If this version was previously dismissed and this isn't a manual check, don't prompt
    if (!isManualCheck && dismissedVersion === info.version) {
      logger.info('update', 'Update downloaded but version was dismissed', { version: info.version });
      return;
    }

    // Backup the database before prompting to install
    const backup = backupDatabase();
    if (backup) {
      logger.info('update', 'Pre-update DB backup', { path: backup.path, sizeKB: (backup.size / 1024).toFixed(1) });
    } else {
      logger.warn('update', 'Pre-update DB backup failed — proceeding anyway');
    }

    // Ask user to confirm the update
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: translate(currentLocale, 'Qflo Update Ready'),
      message: translate(currentLocale, 'A new version ({version}) is ready to install.', { version: info.version }),
      detail: backup
        ? translate(currentLocale, 'A database backup was created. Restart now to apply the update?')
        : translate(currentLocale, 'Restart now to apply the update?'),
      buttons: [
        translate(currentLocale, 'Restart Now'),
        translate(currentLocale, 'Later'),
      ],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      clearDismissed();

      // Check if installed in a protected directory (Program Files, etc.)
      const installDir = path.dirname(app.getPath('exe'));
      const isProtected = installDir.toLowerCase().includes('program files') ||
        installDir.toLowerCase().startsWith('c:\\windows');
      let canWrite = true;
      try {
        const testFile = path.join(installDir, '.qf-update-test');
        require('fs').writeFileSync(testFile, 'test');
        require('fs').unlinkSync(testFile);
      } catch {
        canWrite = false;
      }

      if (!canWrite || isProtected) {
        // Can't auto-update — open GitHub release for manual install
        logger.error('update', 'Install dir is protected — manual install required', {
          code: 'QF-INSTALL-002', installDir,
        });
        const { shell } = require('electron');
        shell.openExternal(`https://github.com/fonthenet/qflow/releases/tag/v${info.version}`);
        await dialog.showMessageBox(mainWindow!, {
          type: 'warning',
          title: 'QF-INSTALL-002',
          message: translate(currentLocale, 'Admin permission required'),
          detail: translate(currentLocale, 'The app was installed with admin rights so auto-update cannot proceed. The download page has opened in your browser — please download and install as Administrator.'),
          buttons: ['OK'],
        });
        return;
      }

      // Close DB before update to prevent data loss from forced taskkill
      backupDatabase();
      closeDB();
      logger.info('update', 'DB backed up and closed — user chose Restart Now');
      autoUpdater.quitAndInstall(false, true);
    } else {
      // User chose "Later" — dismiss this version to prevent re-prompting
      dismissVersion(info.version);
      logger.info('update', 'User deferred update', { version: info.version });
    }
  });
  autoUpdater.on('error', (error) => {
    const msg = error?.message || '';
    const isPermission = msg.includes('EPERM') || msg.includes('EACCES') || msg.includes('elevation');
    logger.error('update', 'Auto-update error', {
      code: isPermission ? 'QF-INSTALL-002' : 'QF-INSTALL-001',
      message: msg,
    });
    setUpdateStatus({
      status: 'error',
      progress: null,
      message: isPermission
        ? `QF-INSTALL-002: ${translate(currentLocale, 'Update failed — app needs admin permission. Please download and install manually.')}`
        : `QF-INSTALL-001: ${error?.message || translate(currentLocale, 'Update check failed')}`,
    });
  });

  try {
    isManualCheck = false;
    await autoUpdater.checkForUpdates();
  } catch {
    setUpdateStatus({
      status: 'idle',
      progress: null,
      message: null,
    });
  }

  // Re-check every 4 hours for stations that run for days
  setInterval(async () => {
    try {
      isManualCheck = false;
      await autoUpdater.checkForUpdates();
    } catch { /* silent */ }
  }, 4 * 60 * 60 * 1000);
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

  cleanupSupport?.();
  // Backup + checkpoint DB before quit — critical for surviving forced updates
  try { backupDatabase(); } catch { /* non-blocking */ }
  shutdownDesktopRuntime(); // includes closeDB()
  app.quit(); // re-trigger quit after flush
});

app.on('will-quit', () => {
  cleanupSupport?.();
  shutdownDesktopRuntime();
  logger.close();
});
