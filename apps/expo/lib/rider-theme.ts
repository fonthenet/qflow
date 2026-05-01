/**
 * Rider-app design tokens. Centralized so every screen feels like
 * one product instead of seven slightly-different variations. Values
 * mirror the customer-facing app's primary palette (blue 700) with a
 * tighter grayscale ramp tuned for the data-heavy rider surfaces.
 */

export const C = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surface2: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',

  text: '#0f172a',
  textMuted: '#64748b',
  textFaint: '#94a3b8',

  primary: '#1d4ed8',
  primaryDark: '#1e40af',
  primaryTint: '#dbeafe',

  success: '#16a34a',
  successTint: '#dcfce7',

  warn: '#d97706',
  warnTint: '#fef3c7',

  danger: '#dc2626',
  dangerTint: '#fee2e2',
} as const;

export const R = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
} as const;

export const SP = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28,
} as const;

export const F = {
  xs: 11, sm: 12, base: 13, md: 14, lg: 15, xl: 17, xxl: 20, hero: 24,
} as const;

/** Format a name for the avatar fallback initials. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Relative time, friendly. "just now" / "5m ago" / "2h ago" / "3d ago". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

/** Format an ISO date as "Mon, 12 May" or similar locale-friendly string. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Format an ISO date as "14:32" (24h local time). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
