// ── Renderer-side error code display helpers ──────────────────────
// Lightweight catalog for UI display — no Node dependencies.

export interface QfErrorDisplay {
  code: string;
  title: string;
  resolution: string;
}

const DISPLAY_CATALOG: Record<string, { title: string; resolution: string }> = {
  'QF-AUTH-001': { title: 'Session expired', resolution: 'Please log in again' },
  'QF-AUTH-002': { title: 'Token refresh failed', resolution: 'Please log in again' },
  'QF-AUTH-003': { title: 'No active session', resolution: 'Please log in' },
  'QF-SYNC-001': { title: 'Sync push failed', resolution: 'Check connection — auto-retrying' },
  'QF-SYNC-002': { title: 'Sync paused', resolution: 'Sync will auto-resume in 60 seconds' },
  'QF-SYNC-003': { title: 'Sync pull failed', resolution: 'Working offline — will retry' },
  'QF-SYNC-004': { title: 'Live updates paused', resolution: 'Polling active — will resume when reconnected' },
  'QF-DB-001': { title: 'Database corrupted', resolution: 'Reset database from Settings or reinstall' },
  'QF-DB-002': { title: 'Database locked', resolution: 'Close other Qflo instances and restart' },
  'QF-DB-003': { title: 'Database version mismatch', resolution: 'Restart the app' },
  'QF-DB-004': { title: 'Database write failed', resolution: 'Restart the app' },
  'QF-NET-001': { title: 'Server unreachable', resolution: 'Check your internet connection' },
  'QF-NET-002': { title: 'Slow connection', resolution: 'Connection is degraded — sync may be delayed' },
  'QF-NET-003': { title: 'DNS resolution failed', resolution: 'Check network and DNS settings' },
  'QF-KIOSK-001': { title: 'Port already in use', resolution: 'Using alternate port' },
  'QF-KIOSK-002': { title: 'Local server failed to start', resolution: 'Check firewall or restart' },
  'QF-INSTALL-001': { title: 'Update download failed', resolution: 'Check connection and retry' },
  'QF-INSTALL-002': { title: 'Update install failed', resolution: 'Close all instances and retry' },
  'QF-APP-001': { title: 'Unexpected error', resolution: 'Restart the app' },
  'QF-APP-002': { title: 'Startup check failed', resolution: 'See details below' },
};

/** Look up a code for display — returns a generic entry for unknown codes */
export function getErrorDisplay(code: string): QfErrorDisplay {
  const entry = DISPLAY_CATALOG[code];
  if (!entry) return { code, title: 'Unknown error', resolution: 'Contact support with this error code' };
  return { code, ...entry };
}

/** Format error details for clipboard (support-friendly) */
export function copyableErrorDetails(code: string, extra?: Record<string, unknown>): string {
  const lines = [
    `Error: ${code}`,
    `Time: ${new Date().toISOString()}`,
    `App: Qflo Station`,
  ];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  return lines.join('\n');
}
