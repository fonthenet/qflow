import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as crypto from 'crypto';
import { printTicket } from './printer';
import { createTray } from './tray';
import {
  initOffline,
  getConnectionStatus,
  syncToServer,
  createTicketOffline,
  callNextOffline,
  callTicketOffline,
  serveTicketOffline,
  completeTicketOffline,
  noShowTicketOffline,
  cancelTicketOffline,
  getOfflineQueue,
  cacheConfig,
  getCachedConfig,
  isOnline,
} from './offline';
import {
  isPortableMode,
  getPortableConfig,
  getDataDir,
  getNodePath,
  injectConfigToEnv,
} from './portable';

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', () => {
      // preferred port busy, let OS pick one
      const server2 = net.createServer();
      server2.listen(0, '127.0.0.1', () => {
        const addr = server2.address() as net.AddressInfo;
        server2.close(() => resolve(addr.port));
      });
      server2.on('error', reject);
    });
  });
}

let mainWindow: BrowserWindow | null = null;
let nextjsProcess: ChildProcess | null = null;
let serverPort: number = 3000;
let isQuitting = false;
let portable = false;
let restartCount = 0;
const MAX_RESTARTS = 3;

// Machine identity (module-level so IPC handlers can access)
const machineId = crypto.createHash('sha256').update(os.hostname() + os.platform() + os.arch()).digest('hex').slice(0, 32);
const machineName = os.hostname();
const osInfoStr = `${os.platform()} ${os.release()} (${os.arch()})`;

async function pingDesktopStatus(appVer: string, pendingSyncs = 0, lastSyncAt: string | null = null) {
  const config = portable ? getPortableConfig() : null;
  const cachedOffice = getCachedConfig('current_office');
  const officeId = cachedOffice?.id || process.env.QUEUEFLOW_OFFICE_ID || '';
  const orgId = cachedOffice?.organization_id || process.env.QUEUEFLOW_ORG_ID || '';

  if (!officeId || !orgId) return;

  try {
    const baseUrl = process.env.QUEUEFLOW_API_URL || 'https://qflow-sigma.vercel.app';
    await fetch(`${baseUrl}/api/desktop-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machineId, machineName, officeId, organizationId: orgId,
        appVersion: appVer, osInfo: osInfoStr, pendingSyncs, lastSyncAt,
      }),
    });
  } catch {
    // Offline — skip ping
  }
}

const isDev = !app.isPackaged;

function getWebDir(): string {
  if (isDev) {
    // __dirname = apps/desktop/dist/main → go up to apps/desktop then into ../web
    return path.join(__dirname, '../../../web');
  }
  return path.join(process.resourcesPath, 'nextjs');
}

function getNextBin(): string {
  if (isDev) {
    // In dev with pnpm, resolve next from the web app's node_modules
    const webDir = getWebDir();
    const candidates = [
      path.join(webDir, 'node_modules', '.bin', 'next'),
      path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
      // pnpm hoists to repo root .bin
      path.join(webDir, '..', '..', 'node_modules', '.bin', 'next'),
    ];
    for (const c of candidates) {
      try {
        const fs = require('fs');
        if (fs.existsSync(c)) return c;
      } catch { /* continue */ }
    }
    // Fallback: let the system find it
    return 'next';
  }
  // In production, point to the actual JS file
  return path.join(process.resourcesPath, 'nextjs', 'node_modules', 'next', 'dist', 'bin', 'next');
}

async function startNextServer(port: number): Promise<void> {
  const webDir = getWebDir();
  console.log(`Starting Next.js server in: ${webDir}`);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    HOSTNAME: 'localhost',
  };

  if (isDev) {
    // In dev, use npx to resolve next correctly in pnpm monorepo
    const isWin = process.platform === 'win32';
    const npxCmd = isWin ? 'npx.cmd' : 'npx';
    console.log(`Using npx to start Next.js in dev mode`);

    nextjsProcess = spawn(npxCmd, ['next', 'start', '-p', String(port)], {
      cwd: webDir,
      env,
      stdio: 'pipe',
      shell: isWin,
    });
  } else {
    const nodeBin = portable ? getNodePath() : 'node';
    const nextBin = getNextBin();
    console.log(`Using node: ${nodeBin}, next: ${nextBin}`);

    nextjsProcess = spawn(nodeBin, [nextBin, 'start', '-p', String(port)], {
      cwd: webDir,
      env,
      stdio: 'pipe',
    });
  }

  nextjsProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Next.js] ${data.toString().trim()}`);
  });

  nextjsProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Next.js Error] ${data.toString().trim()}`);
  });

  nextjsProcess.on('error', (err: Error) => {
    console.error('Failed to start Next.js server:', err);
  });

  nextjsProcess.on('exit', (code: number | null) => {
    console.log(`Next.js server exited with code ${code}`);
    if (!isQuitting && restartCount < MAX_RESTARTS) {
      restartCount++;
      console.log(`Next.js server crashed, attempting restart ${restartCount}/${MAX_RESTARTS}...`);
      startNextServer(port).catch(console.error);
    } else if (!isQuitting) {
      console.error('Max restarts reached. Quitting.');
      app.quit();
    }
  });
}

async function waitForServer(port: number, maxRetries = 30, delay = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok || response.status === 200 || response.status === 304) {
        console.log(`Next.js server is ready on port ${port}`);
        return;
      }
    } catch {
      // Server not ready yet
    }
    console.log(`Waiting for Next.js server... (${i + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error('Next.js server failed to start in time');
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!isQuitting && process.platform === 'win32') {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('print-ticket', async (_event, data) => {
    try {
      await printTicket(data);
      return { success: true };
    } catch (error) {
      console.error('Print error:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      isElectron: true,
      isPortable: portable,
    };
  });

  ipcMain.handle('get-config', () => {
    if (portable) {
      const config = getPortableConfig();
      return {
        supabaseUrl: config.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        supabaseAnonKey: config.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        appName: config.appName,
        offlineOnly: config.offlineOnly,
        isPortable: true,
      };
    }
    return {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      appName: 'QueueFlow',
      offlineOnly: false,
      isPortable: false,
    };
  });

  ipcMain.handle('offline:status', async () => {
    try {
      return await getConnectionStatus();
    } catch (error) {
      console.error('Offline status error:', error);
      return { online: false, pendingSyncs: 0 };
    }
  });

  ipcMain.handle('offline:sync', async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      const result = await syncToServer(supabaseUrl, supabaseKey);
      return { success: true, ...result };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Offline Queue Operations ──────────────────────────────────
  ipcMain.handle('offline:create-ticket', async (_event, params) => {
    try {
      const ticket = createTicketOffline(params);
      return { success: true, ticket };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:call-next', async (_event, { officeId, deskId, staffId, departmentId }) => {
    try {
      const ticket = callNextOffline(officeId, deskId, staffId, departmentId);
      return { success: true, ticket };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:call-ticket', async (_event, { ticketId, deskId, staffId }) => {
    try {
      callTicketOffline(ticketId, deskId, staffId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:serve', async (_event, { ticketId }) => {
    try {
      serveTicketOffline(ticketId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:complete', async (_event, { ticketId }) => {
    try {
      completeTicketOffline(ticketId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:no-show', async (_event, { ticketId }) => {
    try {
      noShowTicketOffline(ticketId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:cancel', async (_event, { ticketId }) => {
    try {
      cancelTicketOffline(ticketId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:get-queue', async (_event, { officeId }) => {
    try {
      const queue = getOfflineQueue(officeId);
      return { success: true, queue };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:cache-config', async (_event, { key, value }) => {
    try {
      cacheConfig(key, value);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:get-cached-config', async (_event, { key }) => {
    try {
      const value = getCachedConfig(key);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('offline:is-online', async () => {
    try {
      return { online: await isOnline() };
    } catch {
      return { online: false };
    }
  });

  // When user logs in on the web UI, cache office info for desktop registration
  ipcMain.handle('desktop:set-office', async (_event, officeInfo) => {
    try {
      cacheConfig('current_office', officeInfo);
      // Immediately ping with new office info
      pingDesktopStatus(app.getVersion(), 0, null);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('desktop:get-machine-info', async () => {
    return { machineId, machineName, osInfo: osInfoStr, appVersion: app.getVersion(), isPortable: portable };
  });
}

async function main(): Promise<void> {
  // Detect portable mode before app is ready (early path override)
  portable = isPortableMode();
  if (portable) {
    const dataDir = getDataDir();
    app.setPath('userData', dataDir);
    injectConfigToEnv();
    console.log(`Portable mode: data dir = ${dataDir}`);
  }

  await app.whenReady();

  console.log('QueueFlow Desktop starting...');
  console.log(`Running in ${isDev ? 'development' : 'production'} mode`);
  if (portable) {
    const config = getPortableConfig();
    console.log(`Portable mode: ${config.offlineOnly ? 'offline-only' : 'online+offline'}`);
  }

  // Initialize offline storage
  try {
    const customDbPath = portable ? path.join(getDataDir(), 'queueflow-offline.db') : undefined;
    await initOffline(customDbPath);
    console.log('Offline storage initialized');
  } catch (error) {
    console.error('Failed to initialize offline storage:', error);
  }

  // Get a free port (use 3456 as preferred to avoid dev server conflicts)
  serverPort = await findFreePort(portable ? 3456 : 3000);
  console.log(`Using port ${serverPort}`);

  // Start Next.js server
  await startNextServer(serverPort);

  // Wait for the server to be ready
  try {
    await waitForServer(serverPort);
  } catch (error) {
    console.error('Failed to start Next.js server:', error);
    app.quit();
    return;
  }

  // Create the main window
  mainWindow = createMainWindow();
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Set up system tray
  createTray(mainWindow);

  // Register IPC handlers
  registerIpcHandlers();

  const appVersion = app.getVersion();

  // Periodically check connection, notify renderer, and auto-sync
  let wasOffline = false;
  setInterval(async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const status = await getConnectionStatus();
        mainWindow.webContents.send('connection-status', status);

        // Ping desktop status to cloud
        pingDesktopStatus(appVersion, status.pendingSyncs, status.lastSync);

        // Auto-sync when coming back online
        if (status.online && wasOffline && status.pendingSyncs > 0) {
          console.log('Connection restored — auto-syncing pending items...');
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
          const result = await syncToServer(supabaseUrl, supabaseKey);
          console.log(`Auto-sync complete: ${result.synced} synced, ${result.failed} failed`);
          mainWindow.webContents.send('sync-complete', result);
        }

        wasOffline = !status.online;
      } catch {
        wasOffline = true;
      }
    }
  }, 15000); // Check every 15s
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('quit', () => {
  if (nextjsProcess) {
    console.log('Killing Next.js server process...');
    nextjsProcess.kill('SIGTERM');
    nextjsProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'win32') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

main().catch((error) => {
  console.error('Fatal error:', error);
  app.quit();
});
