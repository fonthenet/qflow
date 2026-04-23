/**
 * @deprecated
 * This module is a compatibility shim. New code should import directly from
 * `@/lib/rate-limit`, which provides Upstash Redis-backed distributed rate
 * limiting with an automatic in-memory fallback for local dev and tests.
 *
 * The in-memory implementation below is preserved for the fallback path and
 * for existing unit tests that import the real implementation via
 * `vi.importActual`.
 *
 * Migration guide:
 *   - Replace `webhookCheckRateLimit(ip, opts)` calls with:
 *       `await checkRateLimit(request, webhookLimiter)` from `@/lib/rate-limit`
 *   - Replace `extractWebhookIp(headers)` with the inline snippet in
 *     `checkRateLimit` (reads x-forwarded-for / x-real-ip automatically).
 */

// ── Re-exports for callers that still use the old import path ───────
export {
  checkRateLimit,
  webhookLimiter,
  generalLimiter,
  authLimiter,
  publicLimiter,
} from '@/lib/rate-limit';

// ── Legacy in-memory implementation (fallback + tests) ───────────────

export interface WebhookRateLimitOptions {
  /** Maximum requests allowed per window. Default: 100 */
  limit?: number;
  /** Window duration in milliseconds. Default: 60_000 (60 s) */
  windowMs?: number;
}

export interface WebhookRateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Seconds until the window resets (used in Retry-After header) */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

// Module-level store — survives across requests on the same lambda instance.
const _buckets = new Map<string, Bucket>();

/**
 * Extract the best-effort client IP from a Request's headers.
 * Priority: x-forwarded-for (first entry) → x-real-ip → 'unknown'
 */
export function extractWebhookIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

/**
 * @deprecated Use `checkRateLimit(request, webhookLimiter)` from `@/lib/rate-limit`.
 *
 * In-memory token-bucket check. Per-process only — does NOT share state
 * across Vercel lambda instances. Kept for backward-compat and unit tests.
 */
export function webhookCheckRateLimit(
  ip: string,
  options: WebhookRateLimitOptions = {}
): WebhookRateLimitResult {
  const limit = options.limit ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();

  let bucket = _buckets.get(ip);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 1, windowStart: now };
    _buckets.set(ip, bucket);
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    const elapsed = now - bucket.windowStart;
    const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(retryAfterSeconds, 1),
    };
  }

  return {
    allowed: true,
    remaining: limit - bucket.count,
    retryAfterSeconds: Math.ceil(windowMs / 1000),
  };
}

/**
 * Reset all buckets — intended for use in tests only.
 */
export function _resetWebhookBucketsForTesting(): void {
  _buckets.clear();
}
