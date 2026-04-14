// ── Qflo Station Error Code System ─────────────────────────────────
// Every user-facing error gets a unique code for quick diagnosis.
// Format: QF-{CATEGORY}-{NNN}

export interface QfError {
  code: string;
  category: string;
  message: string;
  cause: string;
  resolution: string;
  context?: Record<string, unknown>;
}

export const ERROR_CATALOG: Record<string, Omit<QfError, 'code' | 'context'>> = {
  // ── AUTH ──────────────────────────────────────────────────────────
  'QF-AUTH-001': {
    category: 'AUTH',
    message: 'Session expired',
    cause: 'Token refresh failed after multiple retries',
    resolution: 'Please log in again',
  },
  'QF-AUTH-002': {
    category: 'AUTH',
    message: 'Token refresh failed',
    cause: 'Supabase rejected the refresh token',
    resolution: 'Please log in again',
  },
  'QF-AUTH-003': {
    category: 'AUTH',
    message: 'No active session',
    cause: 'No session found in local database',
    resolution: 'Please log in',
  },

  // ── SYNC ─────────────────────────────────────────────────────────
  'QF-SYNC-001': {
    category: 'SYNC',
    message: 'Sync push failed',
    cause: 'Cloud rejected a local change',
    resolution: 'Check connection — auto-retrying',
  },
  'QF-SYNC-002': {
    category: 'SYNC',
    message: 'Sync paused',
    cause: 'Too many consecutive push failures triggered circuit breaker',
    resolution: 'Sync will auto-resume in 60 seconds',
  },
  'QF-SYNC-003': {
    category: 'SYNC',
    message: 'Sync pull failed',
    cause: 'Could not fetch latest data from cloud',
    resolution: 'Working offline — will retry automatically',
  },
  'QF-SYNC-004': {
    category: 'SYNC',
    message: 'Live updates paused',
    cause: 'Realtime WebSocket connection lost',
    resolution: 'Polling active — live updates will resume when reconnected',
  },

  // ── DATABASE ─────────────────────────────────────────────────────
  'QF-DB-001': {
    category: 'DB',
    message: 'Database corrupted',
    cause: 'SQLite integrity check failed',
    resolution: 'Reset database from Settings or reinstall the app',
  },
  'QF-DB-002': {
    category: 'DB',
    message: 'Database locked',
    cause: 'Another process is holding a lock on the database file',
    resolution: 'Close other Qflo Station instances and restart',
  },
  'QF-DB-003': {
    category: 'DB',
    message: 'Database version mismatch',
    cause: 'Local database schema is outdated or newer than expected',
    resolution: 'App will attempt auto-migration — restart if problem persists',
  },
  'QF-DB-004': {
    category: 'DB',
    message: 'Database write failed',
    cause: 'SQLite INSERT or UPDATE operation threw an error',
    resolution: 'Restart the app — if the problem persists, reset the database',
  },

  // ── NETWORK ──────────────────────────────────────────────────────
  'QF-NET-001': {
    category: 'NET',
    message: 'Server unreachable',
    cause: 'Cannot connect to Supabase (timeout, DNS, or firewall)',
    resolution: 'Check your internet connection',
  },
  'QF-NET-002': {
    category: 'NET',
    message: 'Slow connection',
    cause: 'Server response time exceeds 3 seconds consistently',
    resolution: 'Connection is degraded — sync may be delayed',
  },
  'QF-NET-003': {
    category: 'NET',
    message: 'DNS resolution failed',
    cause: 'Cannot resolve server hostname',
    resolution: 'Check network and DNS settings',
  },

  // ── KIOSK ────────────────────────────────────────────────────────
  'QF-KIOSK-001': {
    category: 'KIOSK',
    message: 'Port already in use',
    cause: 'Default port 8080 is occupied by another application',
    resolution: 'Using alternate port — check status bar for the new URL',
  },
  'QF-KIOSK-002': {
    category: 'KIOSK',
    message: 'Local server failed to start',
    cause: 'HTTP server could not bind to any port',
    resolution: 'Check firewall settings or restart the app',
  },

  // ── INSTALL / UPDATE ─────────────────────────────────────────────
  'QF-INSTALL-001': {
    category: 'INSTALL',
    message: 'Update download failed',
    cause: 'Auto-updater encountered a network error',
    resolution: 'Check connection and retry from the menu, or download manually',
  },
  'QF-INSTALL-002': {
    category: 'INSTALL',
    message: 'Update install failed',
    cause: 'Installer could not complete — files may be locked',
    resolution: 'Close all Qflo Station instances and retry',
  },

  // ── APP ──────────────────────────────────────────────────────────
  'QF-APP-001': {
    category: 'APP',
    message: 'Unexpected error',
    cause: 'An unhandled error occurred in the application',
    resolution: 'Restart the app — if the problem persists, contact support',
  },
  'QF-APP-002': {
    category: 'APP',
    message: 'Startup check failed',
    cause: 'One or more startup diagnostics did not pass',
    resolution: 'See details below for specific issues',
  },
};

/** Create a QfError from a catalog code with optional runtime context */
export function createQfError(code: string, context?: Record<string, unknown>): QfError {
  const entry = ERROR_CATALOG[code];
  if (!entry) {
    return {
      code,
      category: 'UNKNOWN',
      message: 'Unknown error',
      cause: 'No catalog entry for this code',
      resolution: 'Contact support with this error code',
      context,
    };
  }
  return { code, ...entry, context };
}

/** Format a QfError for user-facing display */
export function formatForUser(err: QfError): { title: string; body: string; code: string; resolution: string } {
  return {
    title: err.message,
    body: err.cause,
    code: err.code,
    resolution: err.resolution,
  };
}
