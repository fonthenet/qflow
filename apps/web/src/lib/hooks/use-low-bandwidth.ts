'use client';

import { useEffect, useState } from 'react';

/**
 * Detects whether the user is on a slow connection and applies the
 * `low-bandwidth` CSS class to `<html>`.  The class suppresses animations,
 * transitions, and decorative backgrounds (see globals.css).
 *
 * Detection order:
 * 1. `navigator.connection.saveData === true`   — user explicitly opted in
 * 2. `navigator.connection.effectiveType` is `'slow-2g'` or `'2g'`
 * 3. Falls back to `false` (no class applied)
 *
 * The hook is idempotent: multiple mounts are safe.  Re-runs on `change`
 * events from the NetworkInformation API so it reacts if the connection
 * improves or degrades mid-session.
 */
function getIsLowBandwidth(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  const slow = new Set(['slow-2g', '2g']);
  return slow.has(conn.effectiveType);
}

export function useLowBandwidth(): boolean {
  const [isLow, setIsLow] = useState<boolean>(() => getIsLowBandwidth());

  useEffect(() => {
    const conn = (navigator as any).connection ?? (navigator as any).mozConnection ?? (navigator as any).webkitConnection;

    const apply = () => {
      const low = getIsLowBandwidth();
      setIsLow(low);
      if (low) {
        document.documentElement.classList.add('low-bandwidth');
      } else {
        document.documentElement.classList.remove('low-bandwidth');
      }
    };

    // Apply immediately on mount
    apply();

    if (conn) {
      conn.addEventListener('change', apply);
      return () => conn.removeEventListener('change', apply);
    }
  }, []);

  return isLow;
}
