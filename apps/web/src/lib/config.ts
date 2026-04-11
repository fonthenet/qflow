import 'server-only';

/** Public-facing base URL for the app (no trailing slash). */
export const APP_BASE_URL = (
  process.env.APP_CLIP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://qflo.net'
).replace(/\/+$/, '');

/** Build a tracking URL for a ticket QR token. */
export function trackUrl(qrToken: string): string {
  return `${APP_BASE_URL}/q/${qrToken}`;
}
