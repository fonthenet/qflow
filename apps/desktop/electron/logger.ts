import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: unknown;
}

// ── Constants ────────────────────────────────────────────────────────
const LOG_RETENTION_DAYS = 14;
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── State ────────────────────────────────────────────────────────────
let logDir: string | null = null;
let currentDateStr: string | null = null;
let currentStream: fs.WriteStream | null = null;
let minLevel: LogLevel = 'info';

// ── Helpers ──────────────────────────────────────────────────────────
function getLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }
  return logDir;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getStream(): fs.WriteStream {
  const today = todayString();
  if (currentStream && currentDateStr === today) {
    return currentStream;
  }

  // Close previous day's stream
  if (currentStream) {
    currentStream.end();
  }

  currentDateStr = today;
  const filePath = path.join(getLogDir(), `station-${today}.log`);
  currentStream = fs.createWriteStream(filePath, { flags: 'a' });
  return currentStream;
}

function writeLog(level: LogLevel, component: string, message: string, data?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
  };
  if (data !== undefined) {
    entry.data = data;
  }

  // Also log to console in development
  if (!app.isPackaged) {
    const prefix = `[${level.toUpperCase()}] [${component}]`;
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(prefix, message, data !== undefined ? data : '');
  }

  try {
    const line = JSON.stringify(entry) + '\n';
    getStream().write(line);
  } catch {
    // Swallow write errors — logging should never crash the app
  }
}

// ── Auto-rotate: delete logs older than 14 days ─────────────────────
function rotateOldLogs(): void {
  try {
    const dir = getLogDir();
    const files = fs.readdirSync(dir);
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      // Match station-YYYY-MM-DD.log
      const match = file.match(/^station-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!match) continue;

      const fileDate = new Date(match[1] + 'T00:00:00Z').getTime();
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  } catch {
    // Swallow errors — rotation is best-effort
  }
}

// ── Public API ───────────────────────────────────────────────────────
export const logger = {
  /** Call once at startup to purge old logs and optionally set minimum level */
  init(options?: { minLevel?: LogLevel }) {
    if (options?.minLevel) {
      minLevel = options.minLevel;
    }
    rotateOldLogs();
    logger.info('logger', 'Logger initialized', { logDir: getLogDir(), minLevel });
  },

  debug(component: string, message: string, data?: unknown) {
    writeLog('debug', component, message, data);
  },

  info(component: string, message: string, data?: unknown) {
    writeLog('info', component, message, data);
  },

  warn(component: string, message: string, data?: unknown) {
    writeLog('warn', component, message, data);
  },

  error(component: string, message: string, data?: unknown) {
    writeLog('error', component, message, data);
  },

  /** Gracefully close the write stream (call on app quit) */
  close() {
    if (currentStream) {
      currentStream.end();
      currentStream = null;
    }
  },
};
