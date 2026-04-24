import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, session as electronSession, dialog, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { initSentry } from './sentry';
import { logger } from './logger';
import { initDB, getDB, closeDB, generateOfflineTicketNumber, reserveTicketNumber, logTicketEvent, enqueueSync, startAutoBackup, stopAutoBackup, backupDatabase, getLastRecovery, prepareFreshDatabase } from './db';
import { SyncEngine } from './sync';
import { getTtsAudio, pickVoice as pickTtsVoice } from './tts-cache';
import { scheduleTtsPrewarm, triggerTtsPrewarmNow } from './tts-prewarmer';
import { getChimePath, getChimeDurationMs, getSilenceWarmupPath, cleanupLegacyChimeFiles } from './chime';
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
let miniWindow: BrowserWindow | null = null;

// Broadcast a renderer IPC event to every open BrowserWindow (main +
// mini). Every ticket-mutating handler uses this so both windows stay
// in sync — without it the mini's `tickets.onChange` subscription
// never fires and updates look stuck.
function broadcast(channel: string, ...args: any[]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
  if (channel === 'tickets:changed') detectAndNotifyChanges();
}

// ── Mini-queue preference + active-call gate ──────────────────────
// The mini only opens if (a) the user has opted in AND (b) there's a
// called / serving ticket in the current session's office — no point
// popping a floating card when there's nothing to act on.
function getMiniQueueEnabled(): boolean {
  try {
    const row = getDB().prepare("SELECT value FROM session WHERE key = 'mini_queue_enabled'").get() as { value?: string } | undefined;
    if (row?.value === 'false') return false;
    return true;
  } catch { return true; }
}
function setMiniQueueEnabled(enabled: boolean) {
  try {
    getDB().prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('mini_queue_enabled', ?)").run(enabled ? 'true' : 'false');
  } catch {}
}

// Touch mode — per-device flag persisted in SQLite session table so
// main process can apply window-level effects (hide native menu bar)
// at startup, before the renderer even mounts. Renderer also tracks
// it in localStorage for synchronous CSS class application.
function getTouchModeEnabled(): boolean {
  try {
    const row = getDB().prepare("SELECT value FROM session WHERE key = 'touch_mode'").get() as { value?: string } | undefined;
    return row?.value === 'true';
  } catch { return false; }
}
function setTouchModeEnabled(enabled: boolean) {
  try {
    getDB().prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('touch_mode', ?)").run(enabled ? 'true' : 'false');
  } catch {}
  applyTouchModeToWindows(enabled);
}
function applyTouchModeToWindows(enabled: boolean) {
  // Hide the native File/Edit/View/Window/Language/Help bar in touch
  // mode — operators on a touch screen don't need it and the small
  // top-left text targets aren't reachable. Alt key still reveals it
  // when toggled off via setMenuBarVisibility(false) since
  // setAutoHideMenuBar(true) lets it pop with Alt for power users.
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.setAutoHideMenuBar(enabled);
      w.setMenuBarVisibility(!enabled);
    } catch {}
  }
}
function loadCurrentSessionRaw(): any | null {
  try {
    const row = getDB().prepare("SELECT value FROM session WHERE key = 'current'").get() as { value?: string } | undefined;
    return row?.value ? JSON.parse(row.value) : null;
  } catch { return null; }
}
function hasActiveCall(officeId: string): boolean {
  try {
    const row = getDB().prepare("SELECT COUNT(*) AS n FROM tickets WHERE office_id = ? AND status IN ('called','serving')").get(officeId) as { n?: number } | undefined;
    return (row?.n ?? 0) > 0;
  } catch { return false; }
}

// ── Desktop notifications (Windows toast) ─────────────────────────
// Opt-in per-station alert when a customer-initiated ticket lands or
// an external channel cancels one. Walk-in tickets created by the
// operator themselves are skipped — no point pinging them for their
// own action.
function getDesktopNotificationsEnabled(): boolean {
  try {
    const row = getDB().prepare("SELECT value FROM session WHERE key = 'desktop_notifications_enabled'").get() as { value?: string } | undefined;
    return row?.value === 'true';
  } catch { return false; }
}
function setDesktopNotificationsEnabled(enabled: boolean) {
  try {
    getDB().prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('desktop_notifications_enabled', ?)").run(enabled ? 'true' : 'false');
  } catch {}
}
function showDesktopNotification(title: string, body: string) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
  } catch {}
}

type TicketSnapshot = { status: string; ticket_number: string; source: string | null };
let ticketSnapshot: Map<string, TicketSnapshot> | null = null;
function detectAndNotifyChanges() {
  if (!getDesktopNotificationsEnabled()) return;
  const sess = loadCurrentSessionRaw();
  if (!sess?.office_id) return;
  let rows: any[] = [];
  try {
    rows = getDB().prepare(
      "SELECT id, ticket_number, status, source FROM tickets WHERE office_id = ? AND status IN ('waiting','called','serving','cancelled','no_show')"
    ).all(sess.office_id) as any[];
  } catch { return; }
  const next = new Map<string, TicketSnapshot>();
  for (const r of rows) next.set(r.id, { status: r.status, ticket_number: r.ticket_number, source: r.source ?? null });
  if (!ticketSnapshot) { ticketSnapshot = next; return; }
  for (const [id, cur] of next) {
    const prev = ticketSnapshot.get(id);
    const isCustomerSource = cur.source && cur.source !== 'walk_in';
    if (!prev && cur.status === 'waiting' && isCustomerSource) {
      showDesktopNotification(translate(currentLocale, 'New ticket'), `${cur.ticket_number} — ${cur.source}`);
    } else if (prev && prev.status !== 'cancelled' && cur.status === 'cancelled' && isCustomerSource) {
      showDesktopNotification(translate(currentLocale, 'Ticket cancelled'), cur.ticket_number);
    }
  }
  ticketSnapshot = next;
}
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
        {
          label: translate(currentLocale, 'Team Access'),
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => { mainWindow?.webContents.send('menu:open-team'); mainWindow?.show(); mainWindow?.focus(); },
        },
        {
          label: translate(currentLocale, 'Business Administration'),
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => { mainWindow?.webContents.send('menu:open-business-admin'); mainWindow?.show(); mainWindow?.focus(); },
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
    // Hide menu bar at construction if touch mode is on so the window
    // doesn't flash with the menu before applyTouchModeToWindows runs.
    autoHideMenuBar: getTouchModeEnabled(),
  });
  if (getTouchModeEnabled()) {
    try { mainWindow.setMenuBarVisibility(false); } catch {}
  }

  // Grant microphone access so the Audio output dropdown can enumerate
  // real devices with labels. Chromium hides audiooutput labels unless
  // the origin has active mic permission — we only ever use the mic as
  // a permission token (the actual MediaStream is stopped immediately
  // in listAudioOutputs()) so this is privacy-neutral for our app.
  // Also auto-approve the matching check so `enumerateDevices()`
  // returns the full device list without a prompt.
  const stationSession = mainWindow.webContents.session;
  stationSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') return callback(true);
    callback(false);
  });
  stationSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'mediaKeySystem';
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
          // connect-src lists BOTH localhost and 127.0.0.1 — the renderer's
          // fetch to /api/tts uses 127.0.0.1 (loopback, doesn't hit DNS),
          // and browsers treat the two as distinct origins for CSP.
          `connect-src 'self' https://${supabaseDomain} wss://${supabaseDomain} ${CONFIG.CLOUD_URL} http://localhost:* http://127.0.0.1:*; ` +
          `font-src 'self' data:; ` +
          // Same reasoning for media-src (<audio>) + blob: for blob-URL
          // playback from in-memory audio fetched via blob().
          `media-src 'self' data: blob: http://localhost:* http://127.0.0.1:*;`
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

  // ── Mini floating queue window ────────────────────────────────────
  // When the user clicks the minimize button, hide the main window and
  // pop a small always-on-top card with the current serving + next
  // waiting tickets. Clicking "Open" on the card restores the main
  // window and closes the mini.
  mainWindow.on('minimize', () => {
    // Only pop the mini when the user has opted in AND there's a
    // called/serving ticket worth showing. Otherwise let the window
    // minimize normally — no floating card, no surprise.
    if (!getMiniQueueEnabled()) return;
    const sess = loadCurrentSessionRaw();
    if (!sess?.office_id) return;
    if (!hasActiveCall(sess.office_id)) return;
    openMiniWindow();
  });
}

function openMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    return;
  }
  miniWindow = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0f172a',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    miniWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#mini');
  } else {
    miniWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'mini' });
  }

  miniWindow.once('ready-to-show', () => {
    miniWindow?.show();
  });

  miniWindow.on('closed', () => {
    miniWindow = null;
  });
}

function closeMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
  }
  miniWindow = null;
}

ipcMain.handle('mini:restore-main', () => {
  closeMiniWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle('mini:hide', () => {
  // Just close the mini; main is already minimized to the taskbar so
  // the user can click its tile there to come back.
  closeMiniWindow();
});

ipcMain.handle('mini:get-enabled', () => getMiniQueueEnabled());
ipcMain.handle('mini:set-enabled', (_e, enabled: boolean) => {
  setMiniQueueEnabled(!!enabled);
  if (!enabled) closeMiniWindow();
  return true;
});

ipcMain.handle('touch-mode:get-enabled', () => getTouchModeEnabled());
ipcMain.handle('touch-mode:set-enabled', (_e, enabled: boolean) => {
  setTouchModeEnabled(!!enabled);
  return true;
});

ipcMain.handle('notifications:get-enabled', () => getDesktopNotificationsEnabled());
ipcMain.handle('notifications:set-enabled', (_e, enabled: boolean) => {
  setDesktopNotificationsEnabled(!!enabled);
  if (enabled) {
    // Seed the snapshot so we don't fire for every existing ticket on
    // the very first broadcast after enabling.
    ticketSnapshot = null;
    detectAndNotifyChanges();
  }
  return true;
});

// Renderer-triggered toast (used for pending_approval tickets and
// pending appointments — those live in Supabase only and the renderer
// is the one that sees them first, so it asks main to notify).
ipcMain.handle('notifications:show', (_e, title: string, body: string) => {
  if (!getDesktopNotificationsEnabled()) return false;
  showDesktopNotification(String(title || 'Qflo Station'), String(body || ''));
  return true;
});

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
    cloudUrl: CONFIG.CLOUD_URL,
  }));

  // ── Database recovery / health ────────────────────────────────────
  // Frontend calls this after the window finishes loading to find out
  // whether the local DB was auto-repaired on startup. When the result
  // is not 'healthy' the Station shows a one-time banner so the
  // operator knows to verify today's tickets.
  ipcMain.handle('db:recovery-status', () => getLastRecovery());

  // Manual "Rebuild from Cloud" — Settings → Advanced. Quarantines
  // the current DB, then asks the app to relaunch. On next boot the
  // fresh schema is created and the sync engine rehydrates from the
  // cloud after re-login.
  ipcMain.handle('db:rebuild-from-cloud', async () => {
    try {
      // Stop outbound sync so nothing writes during the swap
      try { syncEngine?.stop(); } catch { /* best-effort */ }
      const result = prepareFreshDatabase();
      logger.warn('db', 'Manual rebuild-from-cloud requested — relaunching', result);
      app.relaunch();
      // Defer quit so the IPC reply reaches the renderer first
      setTimeout(() => app.exit(0), 300);
      return { ok: true, quarantined: result.quarantined };
    } catch (err: any) {
      logger.error('db', 'rebuild-from-cloud failed', { error: err?.message });
      return { ok: false, error: err?.message ?? 'unknown' };
    }
  });

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

      enqueueSync({
        id: ticket.id + '-create',
        operation: 'INSERT',
        table: 'tickets',
        recordId: ticket.id,
        payload: syncPayload,
        createdAt: now,
      });
    })();

    logTicketEvent(ticket.id, 'created', {
      ticketNumber: ticket.ticket_number,
      toStatus: 'waiting',
      source: ticket.source ?? 'station_offline',
      details: { officeId: ticket.office_id, departmentId: ticket.department_id, serviceId: ticket.service_id, isOffline: true },
    });

    notifyDisplays({ type: 'ticket_created', ticket_number: ticket.ticket_number, timestamp: new Date().toISOString() });
    broadcast('tickets:changed');
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
      broadcast('tickets:changed');
      notifyStationClients({ type: 'tickets_changed' });
      return { id: ticket.id, ticket_number: ticket.ticket_number };
    } catch (err: any) {
      logger.error('ipc', 'insert-cloud-ticket error', { error: err?.message });
      return null;
    }
  });

  ipcMain.handle('db:update-ticket', (_e, ticketId: string, updates: any, opts?: { deskName?: string }) => {
    // Validate ticketId format
    if (typeof ticketId !== 'string' || !ticketId) return null;
    const overrideDeskName = typeof opts?.deskName === 'string' && opts.deskName.length > 0 ? opts.deskName : null;

    // Whitelist allowed update fields to prevent arbitrary column writes
    const ALLOWED_FIELDS = new Set([
      'status', 'desk_id', 'called_at', 'called_by_staff_id',
      'serving_started_at', 'completed_at', 'cancelled_at', 'parked_at',
      'recall_count', 'notes', 'priority', 'payment_status',
    ]);
    const safeUpdates: Record<string, any> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.has(key)) safeUpdates[key] = val;
    }
    if (Object.keys(safeUpdates).length === 0) return null;

    // ── Capture previous state BEFORE the update for audit trail ──
    const prevTicket = safeUpdates.status
      ? db.prepare('SELECT ticket_number, status FROM tickets WHERE id = ?').get(ticketId) as any
      : null;

    // Allow no-op status updates — e.g. parking a 'waiting' ticket sends
    // status='waiting' again but only meaningfully changes parked_at. Drop
    // the unchanged status so the validator doesn't reject the whole payload.
    if (safeUpdates.status && prevTicket && prevTicket.status === safeUpdates.status) {
      delete safeUpdates.status;
    }
    if (Object.keys(safeUpdates).length === 0) return null;

    const sets = Object.entries(safeUpdates)
      .map(([key]) => `${key} = ?`)
      .join(', ');
    const values = Object.values(safeUpdates);

    // ── Validate status transition (only when status actually changes) ──
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

    const syncId = enqueueSync({
      id: `${ticketId}-${Date.now()}`,
      operation: 'UPDATE',
      table: 'tickets',
      recordId: ticketId,
      payload: safeUpdates,
    });

    // Immediately push to cloud so web/mobile displays update within 1-2s
    // (the enqueue notifier also fires pushImmediate; this is kept for the
    // named-ID contract used downstream in rewriteOfflineTicket paths)
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
    broadcast('tickets:changed');
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
      // Restaurant/cafe path: renderer passes the table code as an
      // explicit override because the ticket's desk_id is NULL (see
      // FloorMap writeTicket comment — one host stand runs many tables).
      if (overrideDeskName) {
        dskName = overrideDeskName;
      }
      if (!dskName && safeUpdates.desk_id) {
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
    const syncId = enqueueSync({
      id: `notes-${ticketId}-${Date.now()}`,
      operation: 'UPDATE',
      table: 'tickets',
      recordId: ticketId,
      payload: { notes: notes || null },
    });
    syncEngine?.pushImmediate(syncId);
    return { ok: true, queued: true };
  });

  // Customer draft cache — local-only safety net for the Clients panel's
  // rich-text "customer file" + notes fields. The UI writes here on every
  // keystroke debounce alongside the Supabase write, and clears the row once
  // cloud save succeeds. If Supabase is unreachable (offline, token expired)
  // the draft survives a Station restart.
  ipcMain.handle('customer-drafts:save', (_e, customerId: string, notes: string | null, customerFile: string | null) => {
    if (!customerId || typeof customerId !== 'string') return { error: 'invalid_customer' };
    try {
      db.prepare(`
        INSERT INTO customer_drafts (customer_id, notes, customer_file, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET
          notes = excluded.notes,
          customer_file = excluded.customer_file,
          updated_at = excluded.updated_at
      `).run(customerId, notes ?? null, customerFile ?? null, Date.now());
      return { ok: true };
    } catch (e: any) {
      return { error: e?.message || 'draft_save_failed' };
    }
  });

  ipcMain.handle('customer-drafts:get', (_e, customerId: string) => {
    if (!customerId || typeof customerId !== 'string') return null;
    try {
      return db.prepare('SELECT notes, customer_file, updated_at FROM customer_drafts WHERE customer_id = ?').get(customerId) || null;
    } catch { return null; }
  });

  ipcMain.handle('customer-drafts:clear', (_e, customerId: string) => {
    if (!customerId || typeof customerId !== 'string') return { error: 'invalid_customer' };
    try {
      db.prepare('DELETE FROM customer_drafts WHERE customer_id = ?').run(customerId);
      return { ok: true };
    } catch (e: any) { return { error: e?.message || 'draft_clear_failed' }; }
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
    const safe: Record<string, any> = {};
    for (const key of allowed) {
      if (key in updates) {
        cols.push(`${key} = ?`);
        vals.push(updates[key]);
        safe[key] = updates[key];
      }
    }
    if (cols.length === 0) return false;
    if (safe.status && !['open', 'closed', 'on_break'].includes(String(safe.status))) {
      logger.warn('IPC', 'Rejected invalid desk status', { deskId, status: safe.status });
      return false;
    }
    try {
      db.prepare(`UPDATE desks SET ${cols.join(', ')} WHERE id = ?`).run(...vals, deskId);
    } catch (err: any) {
      logger.error('IPC', 'Desk update failed', { deskId, safe, error: err?.message });
      return false;
    }
    // Queue sync to cloud so Supabase stays in sync with Station-UI-driven changes
    // (mobile uses HTTP which already does this; this keeps the two paths consistent).
    try {
      const syncId = enqueueSync({
        id: `desk-${deskId}-${Date.now()}`,
        operation: 'UPDATE',
        table: 'desks',
        recordId: deskId,
        payload: safe,
      });
      syncEngine?.pushImmediate(syncId);
    } catch (err: any) {
      logger.warn('IPC', 'Failed to queue desk sync', { deskId, error: err?.message });
    }
    notifyStationClients({ type: 'tickets_changed' });
    return true;
  });

  ipcMain.handle('db:call-next', async (_e, officeId: string, deskId: string, staffId: string) => {
    if (!officeId || !deskId || !staffId) return null;
    const now = new Date().toISOString();
    const callTs = Date.now();

    // ── CLOUD PRE-CHECK: verify which tickets are truly still waiting in Supabase ──
    // This prevents calling tickets that were cancelled/resolved remotely by customers.
    //
    // We fetch BOTH the cloud "waiting" set AND recent history ("served/cancelled/no_show"
    // from the last 48h). A local ticket is only auto-cancelled when BOTH are true:
    //   1. not in cloud waiting (could be missing for many reasons — RLS, auth, pagination)
    //   2. present in cloud history as a terminal state — proves it really was resolved
    // If #2 can't be proven we skip the ticket for this Call Next round instead of
    // cancelling it. The sync-pull mirror will reconcile it properly later.
    //
    // Empty-result guard: if both cloud fetches succeed but return empty sets,
    // that's almost always a dead auth token / RLS issue (not "every ticket is gone").
    // Discard the pre-check entirely to avoid wiping valid local data.
    let cloudWaitingIds: Set<string> | null = null;
    let cloudHistoryIds: Set<string> | null = null;
    if (syncEngine?.isOnline) {
      try {
        const token = await syncEngine.ensureFreshToken();
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const [waitingRes, historyRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/rest/v1/tickets?office_id=eq.${officeId}&status=eq.waiting&select=id`,
            {
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(3000),
            }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/tickets?office_id=eq.${officeId}&status=in.(served,cancelled,no_show)&cancelled_at=gte.${cutoff}&select=id`,
            {
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(3000),
            }
          ),
        ]);
        if (waitingRes.ok && historyRes.ok) {
          const waitingRows = await waitingRes.json();
          const historyRows = await historyRes.json();
          const waitingSet = new Set<string>(waitingRows.map((r: any) => r.id));
          const historySet = new Set<string>(historyRows.map((r: any) => r.id));

          // Empty-result safeguard — match sync.ts:1812
          const localActiveCount = (db.prepare(
            "SELECT count(*) as cnt FROM tickets WHERE office_id = ? AND status = 'waiting'"
          ).get(officeId) as any)?.cnt ?? 0;
          if (waitingSet.size === 0 && historySet.size === 0 && localActiveCount > 0) {
            logger.warn('call-next', 'Cloud pre-check returned empty sets with local waiting > 0 — skipping pre-check (likely auth/RLS issue)', { officeId, localActiveCount });
          } else {
            cloudWaitingIds = waitingSet;
            cloudHistoryIds = historySet;
          }
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
          // The ticket is waiting locally but not present in the cloud "waiting"
          // set. Two possible realities:
          //   A) The ticket really was resolved remotely (customer cancelled via
          //      WhatsApp, another station served them, etc.) — we should adopt
          //      that terminal state instead of calling a dead ticket.
          //   B) The cloud query just happened to miss it (RLS/auth glitch,
          //      sync-pull not caught up, replication lag) — calling the ticket
          //      is correct and safe.
          //
          // Only treat as (A) when cloud *history* positively proves the ticket
          // is terminal. Otherwise we must proceed and call the ticket — the
          // earlier "skip without cancelling" behaviour stranded perfectly
          // valid tickets whenever the cloud query came back empty or partial.
          const confirmedTerminal = cloudHistoryIds?.has(candidate.id) ?? false;
          if (confirmedTerminal) {
            // Adopt cloud's terminal state locally. We set BOTH cancelled_at
            // and completed_at so the pull-merge protection at sync.ts:1333
            // recognizes this as an operator-style cancel and won't flap the
            // row back to 'waiting' on the next pull if cloud transiently
            // disagrees. No sync_queue row — cloud is already source of truth.
            logTicketEvent(candidate.id, 'auto_cancelled_call_next', {
              fromStatus: 'waiting',
              toStatus: 'cancelled',
              source: 'call_next_cloud_precheck',
              details: { reason: 'confirmed_terminal_in_cloud_history' },
            });
            db.prepare("UPDATE tickets SET status = 'cancelled', cancelled_at = ?, completed_at = ? WHERE id = ? AND status = 'waiting'")
              .run(now, now, candidate.id);
            skippedCount++;
            continue;
          }
          // Not confirmed terminal — fall through and call the ticket.
          logger.warn('call-next', 'Local waiting ticket missing from cloud waiting but not confirmed terminal — calling anyway (sync will reconcile)', {
            ticketId: candidate.id,
            officeId,
          });
        }

        // Call this ticket
        ticket = db.prepare(`
          UPDATE tickets
          SET status = 'called', desk_id = ?, called_by_staff_id = ?, called_at = ?
          WHERE id = ? AND status = 'waiting'
          RETURNING *
        `).get(deskId, staffId, now, candidate.id) as any;

        if (ticket) {
          syncId = enqueueSync({
            id: `${ticket.id}-call-${callTs}`,
            operation: 'CALL',
            table: 'tickets',
            recordId: ticket.id,
            payload: { status: 'called', desk_id: deskId, called_by_staff_id: staffId, called_at: now },
            createdAt: now,
          });
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

  ipcMain.handle('sync:status', () => {
    const health = syncEngine?.getHealth?.() ?? { circuitOpen: false, authExpired: false, oldestPendingAgeMs: null };
    return {
      isOnline: syncEngine?.isOnline ?? false,
      pendingCount: syncEngine?.pendingCount ?? 0,
      lastSyncAt: syncEngine?.lastSyncAt ?? null,
      connectionQuality: syncEngine?.connectionQuality ?? 'offline',
      circuitOpen: health.circuitOpen,
      authExpired: health.authExpired,
      oldestPendingAgeMs: health.oldestPendingAgeMs,
    };
  });

  ipcMain.handle('sync:force', async () => {
    syncEngine?.suppressAuthErrors(); // prevent stale-session race from kicking user out
    await syncEngine?.syncNow();
    await syncEngine?.pullLatest();
    // pullLatest already fires onDataPulled -> notifyDisplays
  });

  ipcMain.handle('sync:refresh-config', async () => {
    await syncEngine?.refreshConfig();
  });

  // Natural-voice announcement played by the MAIN process through the OS
  // audio stack (sound-play -> PowerShell MediaPlayer on Windows). Avoids
  // every renderer pitfall at once: no CSP, no autoplay gesture, no tab
  // reload, no browser involvement. If generation fails the IPC returns
  // an error string so the caller can surface it.
  // Device-routed playback path. Returns the raw chime + voice bytes so
  // the renderer can play them through an HTMLAudioElement with
  // `setSinkId(deviceId)` — the only reliable way to route audio to a
  // specific Windows output (PA amplifier, USB speaker, headset, …) from
  // a sandboxed Electron app. Used when the org has configured a
  // non-default `voice_output_device_id`; otherwise the Station falls
  // back to `voice:announce` which plays via main-process sound-play.
  ipcMain.handle('voice:get-announcement-audio', async (
    _e,
    args: { text: string; language: string; gender: string; rate: number; voiceId?: string | null; includeChime?: boolean },
  ): Promise<{ ok: boolean; error?: string; voice?: string; chime?: { buffer: ArrayBuffer; mime: string } | null; speech?: { buffer: ArrayBuffer; mime: string } | null }> => {
    try {
      const text = String(args?.text ?? '').trim();
      if (!text) return { ok: false, error: 'empty text' };
      const lang = String(args?.language ?? 'en').toLowerCase();
      const gender = args?.gender === 'male' ? 'male' : 'female';
      const rate = Math.max(60, Math.min(130, Number(args?.rate ?? 90)));
      const voice = pickTtsVoice(lang, gender, args?.voiceId);
      const speechBuf = await getTtsAudio(text, voice, rate);
      if (!speechBuf) return { ok: false, error: 'tts generation failed', voice };

      let chimeBytes: Buffer | null = null;
      if (args?.includeChime !== false) {
        try {
          const chimePath = await getChimePath();
          chimeBytes = await fs.promises.readFile(chimePath);
        } catch (err: any) {
          logger.debug('voice', 'chime unavailable for device-routed playback', { error: err?.message });
        }
      }

      // Normalize to plain ArrayBuffer so the IPC serializer hands the
      // renderer a Blob-friendly payload. Node Buffers also work but
      // ArrayBuffer is unambiguous across contexts.
      const speechMime = 'audio/mpeg';
      const speechAb = speechBuf.buffer.slice(speechBuf.byteOffset, speechBuf.byteOffset + speechBuf.byteLength);
      const chimeAb = chimeBytes
        ? chimeBytes.buffer.slice(chimeBytes.byteOffset, chimeBytes.byteOffset + chimeBytes.byteLength)
        : null;
      const chimeMime = chimeBytes ? (chimeBytes.subarray(0, 4).toString('ascii') === 'RIFF' ? 'audio/wav' : 'audio/mpeg') : null;

      return {
        ok: true,
        voice,
        chime: chimeAb ? { buffer: chimeAb as ArrayBuffer, mime: chimeMime! } : null,
        speech: { buffer: speechAb as ArrayBuffer, mime: speechMime },
      };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('voice:announce', async (
    _e,
    args: { text: string; language: string; gender: string; rate: number; voiceId?: string; includeChime?: boolean },
  ): Promise<{ ok: boolean; error?: string; voice?: string }> => {
    try {
      const text = String(args?.text ?? '').trim();
      if (!text) return { ok: false, error: 'empty text' };
      const lang = String(args?.language ?? 'en').toLowerCase();
      const gender = args?.gender === 'male' ? 'male' : 'female';
      const rate = Math.max(60, Math.min(130, Number(args?.rate ?? 90)));
      const voice = pickTtsVoice(lang, gender, args?.voiceId);
      const buf = await getTtsAudio(text, voice, rate);
      if (!buf) return { ok: false, error: 'tts generation failed', voice };

      // Write to a temp file for sound-play (needs a file path, not a buffer).
      // Keep the file around — reusing the cache file would be cleaner but
      // sound-play on Windows shells out to PowerShell which sometimes
      // doesn't release the handle right away.
      const tmp = path.join(app.getPath('temp'), `qflo-voice-${Date.now()}.mp3`);
      await fs.promises.writeFile(tmp, buf);
      try {
        // sound-play ships no types. Untyped dynamic import keeps tsc happy.
        const soundPlay = await import('sound-play' as any);
        const play = (soundPlay as any).play ?? (soundPlay as any).default?.play;
        if (!play) throw new Error('sound-play: play() not found');
        // Chime before the voice. Built-in DMV-style three-tone by
        // default, or the admin's uploaded audio file if present.
        // `sound-play` resolves its play() promise when playback
        // actually finishes (Windows Media Player reports completion),
        // so we can chain the voice right after without timing guesses
        // that get cut off on longer custom chimes.
        //
        // Runs asynchronously in the background — the IPC returns
        // immediately so the Station UI stays responsive.
        (async () => {
          try {
            // Pipeline warmup: each sound-play invocation spawns a cold
            // PowerShell + MediaPlayer process whose first ~300 ms gets
            // clipped while the audio sink opens. A 400 ms silent WAV
            // played first absorbs that clip so the real chime comes out
            // from its very first frame.
            try {
              const silencePath = await getSilenceWarmupPath();
              await Promise.race([
                play(silencePath, 1),
                new Promise<void>((resolve) => setTimeout(resolve, 900)),
              ]);
            } catch (err: any) {
              logger.debug('voice', 'silence warmup failed (non-fatal)', { error: err?.message });
            }

            if (args?.includeChime !== false) {
              try {
                const chimePath = await getChimePath();
                // Estimated duration as a safety net: if sound-play's
                // promise misbehaves on a particular Windows build and
                // never resolves, this timeout unblocks the voice anyway.
                const safetyMs = (await getChimeDurationMs()) + 500;
                await Promise.race([
                  play(chimePath, 1),
                  new Promise<void>((resolve) => setTimeout(resolve, safetyMs)),
                ]);
              } catch (err: any) {
                logger.debug('voice', 'chime play failed (non-fatal)', { error: err?.message });
              }
            }
            try {
              await play(tmp, 1);
            } catch (err: any) {
              logger.warn('voice', 'voice play failed', { error: err?.message });
            } finally {
              setTimeout(() => { fs.promises.unlink(tmp).catch(() => {}); }, 30000);
            }
          } catch (err: any) {
            logger.warn('voice', 'chime+voice sequence failed', { error: err?.message });
          }
        })();
      } catch (err: any) {
        logger.warn('voice', 'sound-play failed', { error: err?.message });
        return { ok: false, error: `playback: ${err?.message ?? err}`, voice };
      }
      return { ok: true, voice };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // Offline-first TTS cache pre-warm. Renderer calls this once after
  // org settings load and again after any voice change in Settings.
  // The prewarmer itself is idempotent + throttled — this handler just
  // forwards the current settings and returns immediately.
  let lastKnownVoiceSettings: {
    voiceId?: string | null; language?: string; gender?: string; rate?: number;
  } | null = null;
  ipcMain.handle('voice:prewarm', (_e, args: {
    voiceId?: string | null; language?: string; gender?: string; rate?: number;
  }) => {
    lastKnownVoiceSettings = args || {};
    triggerTtsPrewarmNow(args || {});
    return { ok: true };
  });

  // Chime is bundled with the app (single source of truth). Clean up
  // any legacy files left in userData from earlier builds on every
  // startup — fire-and-forget, safe to fail.
  void cleanupLegacyChimeFiles();

  // Chime-only playback path. Used when the admin has turned
  // `voice_announcements` OFF but left `announcement_sound_enabled` ON
  // — they want the chime as a pure audio cue with no TTS. Plays the
  // silence warmup first (same cold-start-clip mitigation as
  // voice:announce) then the bundled PA chime.
  ipcMain.handle('chime:play', async () => {
    try {
      const soundPlay = await import('sound-play' as any);
      const play = (soundPlay as any).play ?? (soundPlay as any).default?.play;
      if (!play) return { ok: false, error: 'sound-play unavailable' };
      (async () => {
        try {
          const silencePath = await getSilenceWarmupPath();
          await Promise.race([
            play(silencePath, 1),
            new Promise<void>((resolve) => setTimeout(resolve, 900)),
          ]);
        } catch { /* warmup non-fatal */ }
        try {
          const chimePath = await getChimePath();
          await play(chimePath, 1);
        } catch (err: any) {
          logger.warn('chime.play', 'playback failed', { error: err?.message });
        }
      })();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // Kick off a background warmup using whatever settings the renderer
  // last pushed. On first boot (no push yet) this no-ops quietly; the
  // renderer's subsequent prewarm call covers it. The 30-min retry tick
  // inside scheduleTtsPrewarm keeps resuming after network drops.
  scheduleTtsPrewarm(() => lastKnownVoiceSettings);

  // Windows audio pipeline warmup. `sound-play` shells out to PowerShell +
  // Windows Media Player, and the first play of the session takes
  // ~300-500ms to open the audio sink — long enough to clip the start of
  // the first ticket call's chime. Pre-generate the chime WAV and play
  // it at volume 0 a few seconds after startup so the sink is already
  // open by the time an operator calls the first ticket. Subsequent
  // plays are instant because WMP stays loaded.
  setTimeout(() => {
    (async () => {
      try {
        const chimePath = await getChimePath();
        const soundPlay = await import('sound-play' as any);
        const play = (soundPlay as any).play ?? (soundPlay as any).default?.play;
        if (play) play(chimePath, 0).catch(() => {});
        logger.debug('voice', 'audio pipeline warmup dispatched');
      } catch (err: any) {
        logger.debug('voice', 'audio pipeline warmup skipped', { error: err?.message });
      }
    })();
  }, 4000);

  ipcMain.handle('sync:pending-details', () => {
    return db.prepare(
      `SELECT id, operation, table_name, record_id, attempts, last_error, created_at, organization_id
       FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at ASC`
    ).all();
  });

  // Organization-scoped view of the queue. Diagnostics uses it to show
  // "X items from another business (paused)" separately from the
  // live pending count so admins can see what's blocked and why.
  ipcMain.handle('sync:pending-breakdown', () => {
    try { return syncEngine?.getPendingBreakdown?.() ?? null; }
    catch { return null; }
  });
  ipcMain.handle('sync:discard-foreign', () => {
    const discarded = syncEngine?.discardForeignItems?.() ?? 0;
    syncEngine?.updatePendingCount?.();
    return { discarded };
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
    // Use pushImmediate so the retry bypasses the organization-scope
    // filter in syncNow() — operators clicking Retry on a specific row
    // want that row to fire now and see the real result, not have it
    // silently deferred because its stamped organization_id disagrees
    // with the current session (which can happen after business
    // switches or backfill edge cases).
    try { await syncEngine?.pushImmediate?.(id); }
    catch (err: any) { logger.warn('sync', 'pushImmediate failed from retry', { id, error: err?.message }); }
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

    // Restart the sync engine's intervals on every sign-in. session:clear
    // (sign-out) calls syncEngine.stop() which clears the setInterval;
    // without an explicit restart here, the 10-second syncNow loop stays
    // dead and any pending sync_queue items (ticket_events, etc.) sit at
    // attempts=0 forever until the app is restarted. syncEngine.start()
    // is idempotent — it clears any existing intervals before re-arming.
    try { syncEngine?.start(); }
    catch (err: any) { logger.warn('sync', 'restart on sign-in failed', { error: err?.message }); }

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

  // ── Appointment cache (survives auth failures) ───────────────
  // Stores last-known appointment data in SQLite so the Station never
  // shows a blank calendar just because a token refresh failed.
  ipcMain.handle('cache:save-appointments', (_e, officeId: string, data: string) => {
    try {
      db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES (?, ?)").run(`appt_cache_${officeId}`, data);
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle('cache:get-appointments', (_e, officeId: string) => {
    try {
      const row = db.prepare("SELECT value FROM session WHERE key = ?").get(`appt_cache_${officeId}`) as any;
      return row?.value || null;
    } catch { return null; }
  });

  // ── Auth token provider (single source of truth) ──────────────
  // Renderer asks main process for a valid token instead of managing
  // its own refresh logic. This eliminates the dual-client token drift.
  ipcMain.handle('auth:get-token', async () => {
    try {
      // Always read refresh_token from DB so renderer can auto-refresh
      const sdb = getDB();
      const row = sdb.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
      const session = row ? JSON.parse(row.value) : null;
      const refreshToken = session?.refresh_token || '';

      if (syncEngine) {
        const token = await syncEngine.ensureFreshToken();
        if (token && token !== CONFIG.SUPABASE_ANON_KEY) {
          return { token, refresh_token: refreshToken, ok: true };
        }
      }
      // Fallback: use stored access_token
      if (session?.access_token) {
        return { token: session.access_token, refresh_token: refreshToken, ok: true };
      }
      return { token: '', ok: false, error: 'No valid auth token' };
    } catch (err: any) {
      logger.error('auth', 'get-token IPC failed', { error: err?.message });
      return { token: '', ok: false, error: err?.message };
    }
  });

  // ── Secure credential storage (safeStorage — OS keychain encryption) ──
  ipcMain.handle('auth:save-credentials', (_e, email: string, password: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('auth', 'safeStorage encryption not available — credentials not saved');
        return { ok: false };
      }
      const db = getDB();
      const encrypted = safeStorage.encryptString(password).toString('base64');
      db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('saved_credentials', ?)").run(
        JSON.stringify({ email, encrypted_password: encrypted })
      );
      return { ok: true };
    } catch (err: any) {
      logger.error('auth', 'save-credentials failed', { error: err?.message });
      return { ok: false };
    }
  });

  ipcMain.handle('auth:get-credentials', () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const db = getDB();
      const row = db.prepare("SELECT value FROM session WHERE key = 'saved_credentials'").get() as any;
      if (!row) return null;
      const { email, encrypted_password } = JSON.parse(row.value);
      const password = safeStorage.decryptString(Buffer.from(encrypted_password, 'base64'));
      return { email, password };
    } catch {
      return null;
    }
  });

  ipcMain.handle('auth:clear-credentials', () => {
    try {
      const db = getDB();
      db.prepare("DELETE FROM session WHERE key = 'saved_credentials'").run();
      return { ok: true };
    } catch {
      return { ok: false };
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

  // ── Menu (categories + items) ──────────────────────────────────
  // Menu data is org-scoped and synced through the standard sync_queue
  // so edits made offline (or from the web admin) converge. Station
  // also pulls fresh menu data during pullLatest.
  ipcMain.handle('menu:list-categories', (_e, orgId: string) => {
    if (!orgId) return [];
    return db.prepare(
      "SELECT id, organization_id, name, sort_order, color, icon, active FROM menu_categories WHERE organization_id = ? AND active = 1 ORDER BY sort_order, name"
    ).all(orgId);
  });

  ipcMain.handle('menu:list-items', (_e, orgId: string) => {
    if (!orgId) return [];
    return db.prepare(
      "SELECT id, organization_id, category_id, name, price, discount_percent, sort_order, active FROM menu_items WHERE organization_id = ? AND active = 1 ORDER BY sort_order, name"
    ).all(orgId);
  });

  ipcMain.handle('menu:upsert-category', (_e, orgId: string, cat: any) => {
    if (!orgId || !cat?.name) return null;
    const id = cat.id || randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      organization_id: orgId,
      name: String(cat.name),
      sort_order: Number(cat.sort_order ?? 0),
      color: cat.color ?? null,
      icon: cat.icon ?? null,
      active: cat.active === false ? 0 : 1,
      updated_at: now,
    };
    const exists = db.prepare('SELECT id FROM menu_categories WHERE id = ?').get(id) as any;
    if (exists) {
      db.prepare(
        'UPDATE menu_categories SET name = ?, sort_order = ?, color = ?, icon = ?, active = ?, updated_at = ? WHERE id = ?'
      ).run(payload.name, payload.sort_order, payload.color, payload.icon, payload.active, payload.updated_at, id);
    } else {
      db.prepare(
        'INSERT INTO menu_categories (id, organization_id, name, sort_order, color, icon, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, orgId, payload.name, payload.sort_order, payload.color, payload.icon, payload.active, now, now);
    }
    const syncId = enqueueSync({
      id: `menu_cat-${id}-${Date.now()}`,
      operation: exists ? 'UPDATE' : 'INSERT',
      table: 'menu_categories',
      recordId: id,
      payload: { ...payload, active: payload.active === 1 },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    return { id };
  });

  ipcMain.handle('menu:delete-category', (_e, orgId: string, id: string) => {
    if (!orgId || !id) return null;
    // Soft-delete by flipping active; keeps historical ticket_items.name snapshots valid.
    const now = new Date().toISOString();
    db.prepare('UPDATE menu_categories SET active = 0, updated_at = ? WHERE id = ? AND organization_id = ?').run(now, id, orgId);
    db.prepare('UPDATE menu_items SET active = 0, updated_at = ? WHERE category_id = ? AND organization_id = ?').run(now, id, orgId);
    const syncId = enqueueSync({
      id: `menu_cat-del-${id}-${Date.now()}`,
      operation: 'UPDATE',
      table: 'menu_categories',
      recordId: id,
      payload: { id, active: false, updated_at: now },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    return { ok: true };
  });

  ipcMain.handle('menu:upsert-item', (_e, orgId: string, item: any) => {
    if (!orgId || !item?.name || !item?.category_id) return null;
    const id = item.id || randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      organization_id: orgId,
      category_id: String(item.category_id),
      name: String(item.name),
      price: item.price == null || item.price === '' ? null : Number(item.price),
      discount_percent: Math.max(0, Math.min(100, Math.round(Number(item.discount_percent ?? 0)) || 0)),
      sort_order: Number(item.sort_order ?? 0),
      active: item.active === false ? 0 : 1,
      updated_at: now,
    };
    const exists = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(id) as any;
    if (exists) {
      db.prepare(
        'UPDATE menu_items SET category_id = ?, name = ?, price = ?, discount_percent = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?'
      ).run(payload.category_id, payload.name, payload.price, payload.discount_percent, payload.sort_order, payload.active, payload.updated_at, id);
    } else {
      db.prepare(
        'INSERT INTO menu_items (id, organization_id, category_id, name, price, discount_percent, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, orgId, payload.category_id, payload.name, payload.price, payload.discount_percent, payload.sort_order, payload.active, now, now);
    }
    const syncId = enqueueSync({
      id: `menu_item-${id}-${Date.now()}`,
      operation: exists ? 'UPDATE' : 'INSERT',
      table: 'menu_items',
      recordId: id,
      payload: { ...payload, active: payload.active === 1 },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    return { id };
  });

  ipcMain.handle('menu:delete-item', (_e, orgId: string, id: string) => {
    if (!orgId || !id) return null;
    const now = new Date().toISOString();
    db.prepare('UPDATE menu_items SET active = 0, updated_at = ? WHERE id = ? AND organization_id = ?').run(now, id, orgId);
    const syncId = enqueueSync({
      id: `menu_item-del-${id}-${Date.now()}`,
      operation: 'UPDATE',
      table: 'menu_items',
      recordId: id,
      payload: { id, active: false, updated_at: now },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    return { ok: true };
  });

  // ── Ticket items (orders attached to a seated ticket) ─────────
  ipcMain.handle('ticket-items:list', (_e, ticketId: string) => {
    if (!ticketId) return [];
    return db.prepare(
      "SELECT id, ticket_id, organization_id, menu_item_id, name, price, qty, note, added_at FROM ticket_items WHERE ticket_id = ? ORDER BY added_at ASC"
    ).all(ticketId);
  });

  ipcMain.handle('ticket-items:list-for-tickets', (_e, ticketIds: string[]) => {
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    return db.prepare(
      `SELECT id, ticket_id, organization_id, menu_item_id, name, price, qty, note, added_at
       FROM ticket_items WHERE ticket_id IN (${placeholders}) ORDER BY added_at ASC`
    ).all(...ticketIds);
  });

  ipcMain.handle('ticket-items:add', (_e, orgId: string, ticketId: string, item: any) => {
    if (!orgId || !ticketId || !item?.name) return null;
    const id = randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      ticket_id: ticketId,
      organization_id: orgId,
      menu_item_id: item.menu_item_id ?? null,
      name: String(item.name),
      price: item.price == null || item.price === '' ? null : Number(item.price),
      qty: Math.max(1, Number(item.qty ?? 1)),
      note: item.note ?? null,
      added_at: now,
      added_by: item.added_by ?? null,
    };
    db.prepare(
      'INSERT INTO ticket_items (id, ticket_id, organization_id, menu_item_id, name, price, qty, note, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, ticketId, orgId, payload.menu_item_id, payload.name, payload.price, payload.qty, payload.note, now, payload.added_by);
    const syncId = enqueueSync({
      id: `ticket_item-${id}`,
      operation: 'INSERT',
      table: 'ticket_items',
      recordId: id,
      payload,
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    broadcast('tickets:changed');
    return { id };
  });

  ipcMain.handle('ticket-items:update', (_e, orgId: string, id: string, updates: any) => {
    if (!orgId || !id) return null;
    const ALLOWED = new Set(['qty', 'note', 'price', 'name']);
    const safe: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (ALLOWED.has(k)) safe[k] = v;
    }
    if (!Object.keys(safe).length) return null;
    if (safe.qty !== undefined) safe.qty = Math.max(1, Number(safe.qty));
    const sets = Object.keys(safe).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE ticket_items SET ${sets} WHERE id = ? AND organization_id = ?`).run(...Object.values(safe), id, orgId);
    const syncId = enqueueSync({
      id: `ticket_item-upd-${id}-${Date.now()}`,
      operation: 'UPDATE',
      table: 'ticket_items',
      recordId: id,
      payload: { id, ...safe },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    broadcast('tickets:changed');
    return { ok: true };
  });

  ipcMain.handle('ticket-items:delete', (_e, orgId: string, id: string) => {
    if (!orgId || !id) return null;
    db.prepare('DELETE FROM ticket_items WHERE id = ? AND organization_id = ?').run(id, orgId);
    const syncId = enqueueSync({
      id: `ticket_item-del-${id}`,
      operation: 'DELETE',
      table: 'ticket_items',
      recordId: id,
      payload: { id },
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    broadcast('tickets:changed');
    return { ok: true };
  });

  // ── POS: payments ───────────────────────────────────────────────
  // Cash capture at checkout. Amount is the total charged (derived
  // by the renderer from ticket_items). Tendered/change_given are
  // cash-specific. Method stays flexible for future card/edahabia.
  ipcMain.handle('payments:list-for-ticket', (_e, ticketId: string) => {
    if (!ticketId) return [];
    return db.prepare(
      'SELECT id, ticket_id, organization_id, method, amount, tendered, change_given, note, paid_at, paid_by FROM ticket_payments WHERE ticket_id = ? ORDER BY paid_at'
    ).all(ticketId);
  });

  ipcMain.handle('payments:create', (_e, orgId: string, ticketId: string, payment: any) => {
    if (!orgId || !ticketId || !payment) return null;
    const id = payment.id || randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      ticket_id: ticketId,
      organization_id: orgId,
      method: String(payment.method || 'cash'),
      amount: Number(payment.amount ?? 0),
      tendered: payment.tendered == null ? null : Number(payment.tendered),
      change_given: payment.change_given == null ? null : Number(payment.change_given),
      note: payment.note ?? null,
      paid_at: payment.paid_at || now,
      paid_by: payment.paid_by ?? null,
    };
    db.prepare(
      'INSERT INTO ticket_payments (id, ticket_id, organization_id, method, amount, tendered, change_given, note, paid_at, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.ticket_id, row.organization_id, row.method, row.amount, row.tendered, row.change_given, row.note, row.paid_at, row.paid_by);
    const syncId = enqueueSync({
      id: `ticket_payment-${id}`,
      operation: 'INSERT',
      table: 'ticket_payments',
      recordId: id,
      payload: row,
      organizationId: orgId,
    });
    syncEngine?.pushImmediate(syncId);
    return { id };
  });

  // ── POS: printers (local, per-station) ──────────────────────────
  ipcMain.handle('printers:list-system', async () => {
    // Windows-installed printers. Returned as { name, displayName, status }.
    try {
      const wc = mainWindow?.webContents;
      if (!wc) return [];
      const list = await wc.getPrintersAsync();
      return list.map((p: any) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault: !!p.isDefault,
        status: p.status ?? 0,
      }));
    } catch (e) {
      logger.warn('printers:list-system', 'failed', { error: (e as any)?.message });
      return [];
    }
  });

  ipcMain.handle('printers:list', () => {
    return db.prepare('SELECT id, name, driver_name, width_mm, kind, is_default, enabled, created_at, updated_at FROM printers ORDER BY is_default DESC, name').all();
  });

  ipcMain.handle('printers:upsert', (_e, printer: any) => {
    if (!printer?.name || !printer?.driver_name) return null;
    const id = printer.id || randomUUID();
    const now = new Date().toISOString();
    const width_mm = Number(printer.width_mm) === 58 ? 58 : 80;
    const kind = printer.kind === 'kitchen' ? 'kitchen' : 'receipt';
    const is_default = printer.is_default ? 1 : 0;
    const enabled = printer.enabled === false ? 0 : 1;
    const exists = db.prepare('SELECT id FROM printers WHERE id = ?').get(id) as any;
    // Only one default per kind
    if (is_default) {
      db.prepare('UPDATE printers SET is_default = 0 WHERE kind = ?').run(kind);
    }
    if (exists) {
      db.prepare(
        'UPDATE printers SET name = ?, driver_name = ?, width_mm = ?, kind = ?, is_default = ?, enabled = ?, updated_at = ? WHERE id = ?'
      ).run(printer.name, printer.driver_name, width_mm, kind, is_default, enabled, now, id);
    } else {
      db.prepare(
        'INSERT INTO printers (id, name, driver_name, width_mm, kind, is_default, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, printer.name, printer.driver_name, width_mm, kind, is_default, enabled, now, now);
    }
    return { id };
  });

  ipcMain.handle('printers:delete', (_e, id: string) => {
    if (!id) return null;
    db.prepare('DELETE FROM printers WHERE id = ?').run(id);
    return { ok: true };
  });

  // ── POS: receipt printing ───────────────────────────────────────
  // Opens a hidden BrowserWindow with the caller-supplied receipt
  // HTML and sends it to the Windows driver by name. No native
  // ESC/POS dep — the driver handles rasterization.
  ipcMain.handle('receipts:print', async (_e, args: { driverName: string; html: string; widthMm?: number; silent?: boolean }) => {
    if (!args?.driverName || !args?.html) return { success: false, error: 'missing args' };
    const widthMicrons = (args.widthMm === 58 ? 58 : 80) * 1000;
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(args.html));
      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        win.webContents.print(
          {
            silent: args.silent !== false,
            deviceName: args.driverName,
            margins: { marginType: 'none' },
            pageSize: { width: widthMicrons, height: 297000 }, // tall, driver trims
            printBackground: true,
            color: false,
          },
          (success, err) => resolve({ success, error: err || undefined })
        );
      });
    } catch (e: any) {
      logger.warn('receipts:print failed', e);
      return { success: false, error: e?.message || String(e) };
    } finally {
      try { win.close(); } catch { /* */ }
    }
  });

  // ── POS: Z-report ───────────────────────────────────────────────
  // Daily totals by category, staff, payment method, hour.
  // `day` is an ISO date string YYYY-MM-DD interpreted in local tz.
  ipcMain.handle('reports:z-report', (_e, orgId: string, day: string) => {
    if (!orgId) return null;
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(`${day}T23:59:59.999`);
    const s = start.toISOString();
    const e = end.toISOString();
    const payments = db.prepare(
      `SELECT tp.id, tp.ticket_id, tp.method, tp.amount, tp.tendered, tp.change_given, tp.paid_at, tp.paid_by, t.ticket_number
       FROM ticket_payments tp
       LEFT JOIN tickets t ON t.id = tp.ticket_id
       WHERE tp.organization_id = ? AND tp.paid_at >= ? AND tp.paid_at <= ?
       ORDER BY tp.paid_at`
    ).all(orgId, s, e) as any[];
    const items = db.prepare(
      `SELECT ti.id, ti.ticket_id, ti.name, ti.price, ti.qty, ti.added_at, mi.category_id, mc.name AS category_name
       FROM ticket_items ti
       LEFT JOIN menu_items mi ON mi.id = ti.menu_item_id
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE ti.organization_id = ? AND ti.ticket_id IN (
         SELECT DISTINCT ticket_id FROM ticket_payments WHERE organization_id = ? AND paid_at >= ? AND paid_at <= ?
       )`
    ).all(orgId, orgId, s, e) as any[];
    const staffIds = Array.from(new Set(payments.map((p) => p.paid_by).filter(Boolean)));
    const staff = staffIds.length
      ? db.prepare(`SELECT id, full_name FROM staff WHERE id IN (${staffIds.map(() => '?').join(',')})`).all(...staffIds) as any[]
      : [];
    const staffMap = new Map(staff.map((s: any) => [s.id, s.full_name]));
    // Aggregates
    const totalRevenue = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const txCount = payments.length;
    const byMethod: Record<string, { count: number; amount: number }> = {};
    for (const p of payments) {
      const m = p.method || 'cash';
      if (!byMethod[m]) byMethod[m] = { count: 0, amount: 0 };
      byMethod[m].count += 1;
      byMethod[m].amount += Number(p.amount) || 0;
    }
    const byCategory: Record<string, { name: string; qty: number; amount: number }> = {};
    for (const it of items) {
      const key = it.category_id || '_uncategorized';
      const name = it.category_name || 'Uncategorized';
      if (!byCategory[key]) byCategory[key] = { name, qty: 0, amount: 0 };
      byCategory[key].qty += Number(it.qty) || 0;
      byCategory[key].amount += (Number(it.price) || 0) * (Number(it.qty) || 0);
    }
    const byStaff: Record<string, { name: string; count: number; amount: number }> = {};
    for (const p of payments) {
      const key = p.paid_by || '_none';
      const name = staffMap.get(p.paid_by) || '—';
      if (!byStaff[key]) byStaff[key] = { name, count: 0, amount: 0 };
      byStaff[key].count += 1;
      byStaff[key].amount += Number(p.amount) || 0;
    }
    const byHour: Record<string, { count: number; amount: number }> = {};
    for (const p of payments) {
      const d = new Date(p.paid_at);
      const h = String(d.getHours()).padStart(2, '0');
      if (!byHour[h]) byHour[h] = { count: 0, amount: 0 };
      byHour[h].count += 1;
      byHour[h].amount += Number(p.amount) || 0;
    }
    return {
      day,
      totalRevenue,
      txCount,
      byMethod,
      byCategory,
      byStaff,
      byHour,
      payments: payments.map((p) => ({
        ...p,
        staff_name: staffMap.get(p.paid_by) || null,
      })),
    };
  });

  // ── POS: staff lookup (for receipt display) ─────────────────────
  ipcMain.handle('staff:get', (_e, staffId: string) => {
    if (!staffId) return null;
    return db.prepare('SELECT id, full_name, email, role FROM staff WHERE id = ?').get(staffId);
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
      // Return the latest event per ticket, newest first. We widen the window
      // to 7 days (was 24h) so a slow shift still sees yesterday's completions,
      // and we filter by office via a join on `tickets` so the recent list
      // doesn't mix offices when an operator switches desks.
      const hasOffice = typeof officeId === 'string' && officeId.length > 0;
      const sql = `
        SELECT a.ticket_id, a.ticket_number, a.event_type, a.to_status, a.created_at, a.details
        FROM ticket_audit_log a
        INNER JOIN (
          SELECT ticket_id, MAX(created_at) as max_created
          FROM ticket_audit_log
          WHERE created_at >= datetime('now', '-7 days')
          GROUP BY ticket_id
        ) latest ON a.ticket_id = latest.ticket_id AND a.created_at = latest.max_created
        ${hasOffice ? 'INNER JOIN tickets t ON t.id = a.ticket_id AND t.office_id = ?' : ''}
        ORDER BY a.created_at DESC
        LIMIT ?
      `;
      const params = hasOffice ? [officeId, limit] : [limit];
      const rows = db.prepare(sql).all(...params) as any[];
      return rows.map((r: any) => ({
        id: r.ticket_id || null,
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

      // Also get full ticket row as fallback/supplement
      const ticket = db.prepare(`
        SELECT id, ticket_number, office_id, department_id, service_id, desk_id,
               status, priority, customer_data, created_at, called_at,
               serving_started_at, completed_at, cancelled_at, parked_at,
               recall_count, notes, is_remote, source
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
    // Silent install when we have write access; non-silent for elevation (UAC)
    const installDir = path.dirname(app.getPath('exe'));
    const isProtected = installDir.toLowerCase().includes('program files') || installDir.toLowerCase().startsWith('c:\\windows');
    let canWrite = true;
    try {
      const testFile = path.join(installDir, '.qf-update-test');
      require('fs').writeFileSync(testFile, 'test');
      require('fs').unlinkSync(testFile);
    } catch { canWrite = false; }
    const useSilent = canWrite && !isProtected;
    logger.info('update', 'DB backed up and closed — proceeding with quitAndInstall', { silent: useSilent });
    setImmediate(() => {
      autoUpdater.quitAndInstall(useSilent, true);
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
  // Another instance is already running — focus it instead of launching a duplicate.
  // But if the old instance is a zombie (no visible window), it won't respond to
  // second-instance. The user must kill it from Task Manager. On next start, we'll
  // get the lock. Don't silently quit — show a brief log so it's diagnosable.
  console.log('[startup] Another instance holds the lock — quitting. If the app is not visible, end "Qflo Station" in Task Manager.');
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

  // Init SQLite — with hard-guard recovery. If initDB throws (corrupt
  // WAL replay, disk I/O error, schema migration failure on a damaged
  // file) we quarantine the DB and retry ONCE with a clean slate so
  // the app still boots. Sync will rehydrate from the cloud; the UI
  // will prompt the user to re-login.
  try {
    initDB();
  } catch (err: any) {
    logger.error('boot', 'initDB failed — forcing fresh DB and retrying', { error: err?.message });
    try { prepareFreshDatabase(); } catch (e: any) {
      logger.error('boot', 'prepareFreshDatabase also failed', { error: e?.message });
    }
    initDB(); // if this throws, the app exits — at that point the
              // environment itself (disk, permissions) is broken.
  }

  const recovery = getLastRecovery();
  if (recovery && recovery.action !== 'healthy') {
    logger.warn('boot', 'Started with recovered database', recovery);
    // Surface to the operator. Notification is a hard requirement here
    // — a silent repair risks confusion when "today's ticket list" looks
    // different than what was on screen before the crash. The renderer
    // will also pick this up via db:recovery-status once the window is
    // ready and render a more detailed banner.
    app.whenReady().then(() => {
      try {
        const title = 'Qflo Station — local database repaired';
        const body = recovery.action === 'restored'
          ? 'The local database was corrupt and has been restored from the latest healthy backup. Please verify today\'s tickets.'
          : 'The local database could not be repaired and has been rebuilt from the cloud. Please sign in again.';
        new Notification({ title, body }).show();
      } catch { /* notifications optional */ }
    });
  }

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
      broadcast('tickets:changed');
      notifyStationClients({ type: 'tickets_changed' });
    },
    (error) => {
      // Surface sync/reconciliation errors to the Station UI
      mainWindow?.webContents.send('sync:error', error);
    },
    (token, refreshToken) => {
      // Token was refreshed by sync engine — broadcast to renderer
      // so its Supabase client gets the new token immediately
      // CRITICAL: send refresh_token too so renderer can auto-refresh on its own
      mainWindow?.webContents.send('auth:token-refreshed', token, refreshToken);
    },
    async () => {
      // Read stored credentials from encrypted safeStorage (OS keychain)
      try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        const db = getDB();
        const row = db.prepare("SELECT value FROM session WHERE key = 'saved_credentials'").get() as any;
        if (!row) return null;
        const { email, encrypted_password } = JSON.parse(row.value);
        const password = safeStorage.decryptString(Buffer.from(encrypted_password, 'base64'));
        return { email, password };
      } catch {
        return null;
      }
    },
  );
  syncEngine.setConfigChangedCallback(() => {
    mainWindow?.webContents.send('config:changed');
    notifyDisplays({ type: 'config_changed', timestamp: new Date().toISOString() });
    notifyStationClients({ type: 'config_changed' });
  });
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
        logger.warn('startup', 'Refresh token is stale — attempting silent re-auth', { status: res.status });
        // Try silent re-auth with stored credentials before showing modal
        const reAuthResult = await syncEngine?.attemptSilentReAuth();
        if (!reAuthResult) {
          logger.error('startup', 'Silent re-auth failed — prompting re-login', { code: 'QF-AUTH-001' });
          setTimeout(() => {
            mainWindow?.webContents.send('auth:session-expired');
          }, 3000);
        }
      } else {
        // Token is valid — update session with fresh tokens
        const data = await res.json();
        if (data.access_token) {
          const updated = { ...session, access_token: data.access_token, refresh_token: data.refresh_token ?? session.refresh_token };
          // Use UPDATE (not INSERT OR REPLACE) to preserve station_token column for kiosk auth
          sdb.prepare("UPDATE session SET value = ? WHERE key = 'current'").run(JSON.stringify(updated));
          // Push fresh token to renderer so its Supabase client + data fetches work immediately
          // CRITICAL: include refresh_token so renderer can auto-refresh on its own
          mainWindow?.webContents.send('auth:token-refreshed', data.access_token, updated.refresh_token);
          // Safety net: push token again after 3s in case renderer wasn't ready for the first one
          setTimeout(() => {
            mainWindow?.webContents.send('auth:token-refreshed', data.access_token, updated.refresh_token);
          }, 3000);
          logger.info('startup', 'Startup token validation passed — session refreshed + renderer notified');
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
      broadcast('tickets:changed');
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

      // Close DB before update to prevent data loss from forced taskkill
      backupDatabase();
      closeDB();

      if (!canWrite || isProtected) {
        // Install dir needs elevation — NSIS installer will show UAC prompt
        // thanks to allowElevation: true in electron-builder config
        logger.info('update', 'Install dir is protected — attempting elevated install via NSIS UAC', {
          installDir,
        });
      }

      // Silent install (no progress UI) when we have write access;
      // non-silent when elevation needed so NSIS can show UAC prompt
      const useSilent = canWrite && !isProtected;
      logger.info('update', 'DB backed up and closed — user chose Restart Now', { silent: useSilent });
      try {
        autoUpdater.quitAndInstall(useSilent, true);
      } catch (installErr: any) {
        // If quitAndInstall fails (e.g. UAC denied), fall back to GitHub release
        logger.error('update', 'quitAndInstall failed — opening GitHub release', {
          code: 'QF-INSTALL-002', installDir, error: installErr?.message,
        });
        const { shell } = require('electron');
        shell.openExternal(`https://github.com/fonthenet/qflow/releases/tag/v${info.version}`);
        await dialog.showMessageBox(mainWindow!, {
          type: 'warning',
          title: 'QF-INSTALL-002',
          message: translate(currentLocale, 'Admin permission required'),
          detail: translate(currentLocale, 'The installer needs admin permission. The download page has opened in your browser — please download and install as Administrator.'),
          buttons: ['OK'],
        });
      }
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
