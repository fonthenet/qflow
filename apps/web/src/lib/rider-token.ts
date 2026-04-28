import 'server-only';

import crypto from 'crypto';

/**
 * Stateless rider portal token. Operator dispatches a delivery → Station
 * generates a per-ticket URL `/rider/<ticketId>/<token>` and copies it to
 * the clipboard so the operator can paste it into a WA chat with the
 * driver. The driver opens the link on their phone, the page authenticates
 * the token server-side, then starts streaming geolocation.
 *
 * Why HMAC over a row in DB:
 *   - Zero new state. No expiry table to garbage-collect.
 *   - Rotating INTERNAL_WEBHOOK_SECRET invalidates every outstanding link
 *     (useful if a link leaks).
 *   - Same secret already powers the dispatch / delivered API auth.
 *
 * The token is base64url(HMAC-SHA256(ticketId, secret)) truncated to 32
 * chars — long enough to be unguessable (~190 bits), short enough to
 * paste into WhatsApp without wrapping.
 */

const RIDER_TOKEN_LEN = 32;

function getSecret(): string {
  const s = process.env.INTERNAL_WEBHOOK_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!s) {
    // Fail loudly in dev — silently failing here would let any URL pass
    // because the empty-secret HMAC always matches.
    console.error('[rider-token] INTERNAL_WEBHOOK_SECRET not set; rider links will not authenticate');
  }
  return s;
}

export function generateRiderToken(ticketId: string): string {
  const secret = getSecret();
  if (!secret) return '';
  return crypto
    .createHmac('sha256', secret)
    .update(`rider:${ticketId}`)
    .digest('base64url')
    .slice(0, RIDER_TOKEN_LEN);
}

/**
 * Constant-time verify. Always compares against a freshly-generated
 * token of the same length so a timing attacker can't probe length.
 */
export function verifyRiderToken(ticketId: string, token: string | null | undefined): boolean {
  if (!ticketId || !token || token.length !== RIDER_TOKEN_LEN) return false;
  const expected = generateRiderToken(ticketId);
  if (!expected) return false;
  // timingSafeEqual throws when buffer lengths mismatch; guarded above.
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

/** "https://qflo.net/rider/<id>/<token>" — used by Station's Copy Rider Link. */
export function buildRiderPortalUrl(baseUrl: string, ticketId: string): string {
  const token = generateRiderToken(ticketId);
  return `${baseUrl.replace(/\/+$/, '')}/rider/${encodeURIComponent(ticketId)}/${token}`;
}
