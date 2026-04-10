import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

// ── Redis client ────────────────────────────────────────────────────

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ── Rate limiters ───────────────────────────────────────────────────

/** General API routes: 60 requests per 60 seconds per IP */
export const generalLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '60 s'),
  prefix: 'rl:general',
  analytics: true,
});

/** Auth-sensitive routes (login, signup): 10 per 60 seconds per IP */
export const authLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:auth',
  analytics: true,
});

/** Public booking/ticket routes: 20 per 60 seconds per IP */
export const publicLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '60 s'),
  prefix: 'rl:public',
  analytics: true,
});

/** Webhook routes (Meta, etc.): 200 per 60 seconds per IP */
export const webhookLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, '60 s'),
  prefix: 'rl:webhook',
  analytics: true,
});

// ── Helper ──────────────────────────────────────────────────────────

/**
 * Check rate limit and return a 429 response if exceeded.
 * Returns `null` if the request is allowed.
 *
 * Usage in a route handler:
 * ```ts
 * const blocked = await checkRateLimit(request, publicLimiter);
 * if (blocked) return blocked;
 * ```
 */
export async function checkRateLimit(
  request: Request,
  limiter: Ratelimit,
  identifier?: string,
): Promise<NextResponse | null> {
  // Skip rate limiting if Redis is not configured
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  const ip =
    identifier ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous';

  try {
    const { success, limit, remaining, reset } = await limiter.limit(ip);

    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': reset.toString(),
            'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
          },
        },
      );
    }

    return null;
  } catch (err) {
    // If Redis is down, don't block requests — fail open
    console.error('[rate-limit] Redis error, failing open:', err);
    return null;
  }
}
