'use client';

import { useLowBandwidth } from '@/lib/hooks/use-low-bandwidth';

/**
 * Mounts the low-bandwidth detector in the React tree.
 * When effectiveType is 'slow-2g'/'2g' or saveData is true, adds the
 * `low-bandwidth` class to <html> — which suppresses animations and
 * decorative gradients (see globals.css).
 *
 * Renders nothing — side-effect only.
 */
export function LowBandwidthDetector() {
  useLowBandwidth();
  return null;
}
