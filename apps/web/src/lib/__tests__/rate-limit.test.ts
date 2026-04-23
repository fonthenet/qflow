/**
 * Tests for apps/web/src/lib/rate-limit.ts
 *
 * Two paths:
 *  1. Fallback (no UPSTASH_* env vars) — uses in-memory ephemeral store.
 *  2. Upstash path — Redis client is mocked; verifies the Ratelimit wrapper
 *     delegates correctly and that checkRateLimit returns 429 on block.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(ip = '1.2.3.4'): Request {
  return new Request('https://qflo.app/api/test', {
    headers: { 'x-forwarded-for': ip },
  });
}

// ── Suite 1: fallback path (no env vars) ───────────────────────────────────

describe('rate-limit — fallback path (no Upstash env vars)', () => {
  beforeEach(() => {
    // Ensure env vars are absent for this suite
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Clear module registry so rate-limit.ts re-evaluates without env vars
    vi.resetModules();
  });

  it('allows requests when Redis is not configured', async () => {
    const { checkRateLimit, webhookLimiter } = await import('@/lib/rate-limit');
    const req = makeRequest();
    const result = await checkRateLimit(req, webhookLimiter);
    // Fallback: ephemeral cache → first request always allowed
    expect(result).toBeNull();
  });

  it('does not throw when limiter.limit() is called', async () => {
    const { checkRateLimit, publicLimiter } = await import('@/lib/rate-limit');
    const req = makeRequest('5.6.7.8');
    await expect(checkRateLimit(req, publicLimiter)).resolves.not.toThrow();
  });
});

// ── Suite 2: Upstash path (mocked Redis) ──────────────────────────────────

describe('rate-limit — Upstash path (mocked @upstash/redis)', () => {
  const MOCK_URL = 'https://redis.upstash.io';
  const MOCK_TOKEN = 'test-token-abc123';

  // Capture the mock limit fn so tests can control its return value
  const mockLimit = vi.fn();

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = MOCK_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = MOCK_TOKEN;
    vi.resetModules();

    // Mock @upstash/redis so no real HTTP calls happen
    vi.doMock('@upstash/redis', () => {
      return {
        Redis: vi.fn().mockImplementation(() => ({})),
      };
    });

    // Mock @upstash/ratelimit: Ratelimit constructor returns object with
    // `.limit()` pointing at our spy
    vi.doMock('@upstash/ratelimit', () => {
      const slidingWindow = vi.fn().mockReturnValue({ type: 'sliding' });
      const RatelimitMock = vi.fn().mockImplementation(() => ({
        limit: mockLimit,
      }));
      (RatelimitMock as unknown as { slidingWindow: typeof slidingWindow }).slidingWindow =
        slidingWindow;
      return { Ratelimit: RatelimitMock };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('returns null when limiter allows the request', async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 200,
      remaining: 199,
      reset: Date.now() + 60_000,
    });
    const { checkRateLimit, webhookLimiter } = await import('@/lib/rate-limit');
    const result = await checkRateLimit(makeRequest(), webhookLimiter);
    expect(result).toBeNull();
  });

  it('returns 429 NextResponse when limiter blocks the request', async () => {
    const resetAt = Date.now() + 30_000;
    mockLimit.mockResolvedValue({
      success: false,
      limit: 200,
      remaining: 0,
      reset: resetAt,
    });
    const { checkRateLimit, webhookLimiter } = await import('@/lib/rate-limit');
    const response = await checkRateLimit(makeRequest(), webhookLimiter);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);

    const body = await response!.json();
    expect(body.error).toMatch(/too many requests/i);

    expect(response!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response!.headers.get('Retry-After')).toBeTruthy();
  });

  it('uses a custom identifier when provided', async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60_000,
    });
    const { checkRateLimit, generalLimiter } = await import('@/lib/rate-limit');
    await checkRateLimit(makeRequest(), generalLimiter, 'user:uuid-1234');
    expect(mockLimit).toHaveBeenCalledWith('user:uuid-1234');
  });

  it('fails open (returns null) when Redis throws', async () => {
    mockLimit.mockRejectedValue(new Error('Redis connection refused'));
    const { checkRateLimit, webhookLimiter } = await import('@/lib/rate-limit');
    const result = await checkRateLimit(makeRequest(), webhookLimiter);
    // Must not propagate the error — fail open
    expect(result).toBeNull();
  });
});
