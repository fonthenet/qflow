import { useEffect, useState } from 'react';

export type SyncMode = 'cloud' | 'local_backup';

/**
 * React hook that mirrors the Station's sync-mode setting.
 *
 * Cloud-dependent UI (online booking links, WhatsApp send buttons,
 * public display QRs, multi-device callouts) should consult this and
 * hide / disable itself in 'local_backup' mode — those surfaces don't
 * function when the Station isn't pushing in real time.
 *
 * Updates live via the 'sync-mode:changed' IPC event so toggling in
 * Settings re-renders consumers without a refresh.
 */
export function useSyncMode(): SyncMode {
  const [mode, setMode] = useState<SyncMode>('cloud');

  useEffect(() => {
    const qf = (window as any).qf;
    let unsub: (() => void) | undefined;
    qf?.syncMode?.get?.().then((m: SyncMode) => setMode(m)).catch(() => {});
    unsub = qf?.syncMode?.onChanged?.((m: SyncMode) => setMode(m));
    return () => { try { unsub?.(); } catch {} };
  }, []);

  return mode;
}

/** Convenience helper for non-React call sites. Async — reads from IPC. */
export async function getSyncModeAsync(): Promise<SyncMode> {
  try {
    const m = await (window as any).qf?.syncMode?.get?.();
    return m === 'local_backup' ? 'local_backup' : 'cloud';
  } catch {
    return 'cloud';
  }
}
