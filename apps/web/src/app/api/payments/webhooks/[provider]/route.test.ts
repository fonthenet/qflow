/**
 * Regression tests for /api/payments/webhooks/[provider]/route.ts
 *
 * Critical invariants:
 * - Unknown provider → 400
 * - Invalid signature → 400
 * - Valid Stripe event → 200, row inserted in payment_events
 * - Duplicate event_id replay → 200 with duplicate:true, no new row
 *
 * Security hardening invariants (2026-04-24):
 * - Fix 1: mismatched metadata.organization_id vs customer-derived org → flagged
 * - Fix 2: getImplementedProviderForCountry('DZ') returns only implemented providers
 * - Fix 3: 101st request from same IP in 60s window → 429
 * - Fix 4: non-dup insert error → 200 + dead-letter row attempt
 *
 * Supabase admin client is mocked entirely — no real DB access.
 * The Stripe SDK is mocked — no network calls.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoist mock handles ────────────────────────────────────────────────────────
// Must use vi.hoisted so they're available inside vi.mock factories (which get
// hoisted to the top of the module by the vitest transform).

const { mockConstructEvent, mockInsert, mockFrom, mockResolveCustomerOrg } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockInsert: vi.fn(),
  mockFrom: vi.fn(),
  mockResolveCustomerOrg: vi.fn<() => Promise<string | null>>(),
}));

// ── Stripe SDK mock ───────────────────────────────────────────────────────────

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    paymentIntents: { create: vi.fn() },
    refunds: { create: vi.fn() },
    webhooks: { constructEvent: mockConstructEvent },
  })),
}));

// ── billing/stripe mock — verifyStripeWebhook + resolveOrgFromStripeCustomer ──

vi.mock('@/lib/billing/stripe', () => ({
  verifyStripeWebhook: vi.fn(),
  resolveOrgFromStripeCustomer: mockResolveCustomerOrg,
  normaliseStripeEvent: vi.fn(),
  getStripeClient: vi.fn(),
}));

// ── Supabase admin client mock ────────────────────────────────────────────────
// Route now uses createAdminClient() (service role, no cookies).

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: mockFrom,
  }),
}));

// ── Rate-limit mock — reset buckets between tests ─────────────────────────────
// We import the real module but spy on it so individual tests can control behavior.
vi.mock('@/lib/webhook-rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webhook-rate-limit')>();
  return {
    ...actual,
    extractWebhookIp: vi.fn().mockReturnValue('1.2.3.4'),
    // Default: allow all. Override in specific tests.
    webhookCheckRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 99, retryAfterSeconds: 60 }),
  };
});

// ── Import the route after mocks ──────────────────────────────────────────────

import { POST } from './route';
import { webhookCheckRateLimit } from '@/lib/webhook-rate-limit';
import { verifyStripeWebhook } from '@/lib/billing/stripe';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStripeRequest(body: unknown, signature = 'valid-sig', ip?: string): NextRequest {
  return new NextRequest('https://example.com/api/payments/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

const STRIPE_EVENT_BODY = {
  id: 'evt_unique_001',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_abc',
      amount: 2000,
      amount_received: 2000,
      currency: 'eur',
      customer: 'cus_stripe_abc',
      metadata: { organization_id: 'org-test-1' },
    },
  },
};

// ── Test setup ────────────────────────────────────────────────────────────────

function buildFromChain(existingEvent: unknown) {
  return vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existingEvent, error: null }),
    }),
    insert: mockInsert,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Normalised event returned by verifyStripeWebhook
const NORMALISED_EVENT = {
  type: 'payment.succeeded',
  providerEventId: 'evt_unique_001',
  reference: 'pi_abc',
  amount: 2000,
  currency: 'EUR',
  metadata: { organization_id: 'org-test-1' },
  raw: STRIPE_EVENT_BODY,
};

describe('POST /api/payments/webhooks/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stub');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    // Default: verify succeeds
    vi.mocked(verifyStripeWebhook).mockResolvedValue(NORMALISED_EVENT);
    // Default: no existing event (not a duplicate), insert succeeds
    mockFrom.mockImplementation(buildFromChain(null));
    mockInsert.mockResolvedValue({ error: null });
    // Default resolveCustomerOrg: returns null (no customer mapping)
    mockResolveCustomerOrg.mockResolvedValue(null);
    // Default: rate limit allows all
    vi.mocked(webhookCheckRateLimit).mockReturnValue({ allowed: true, remaining: 99, retryAfterSeconds: 60 });
  });

  it('returns 400 for an unknown provider', async () => {
    const req = new NextRequest('https://example.com/api/payments/webhooks/unknown-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const params = Promise.resolve({ provider: 'unknown-provider' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown provider/i);
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    vi.mocked(verifyStripeWebhook).mockResolvedValue(null);

    const req = makeStripeRequest(STRIPE_EVENT_BODY, 'bad-signature');
    const params = Promise.resolve({ provider: 'stripe' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it('returns 200 and inserts a payment_event row for a valid Stripe event', async () => {

    const req = makeStripeRequest(STRIPE_EVENT_BODY);
    const params = Promise.resolve({ provider: 'stripe' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.duplicate).toBeUndefined();

    // Verify insert was called with the correct provider + event id
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        provider_event_id: 'evt_unique_001',
        event_type: 'payment.succeeded',
      })
    );
  });

  it('stores the raw body JSON (not the Event object) as raw_payload', async () => {

    const req = makeStripeRequest(STRIPE_EVENT_BODY);
    const params = Promise.resolve({ provider: 'stripe' });
    await POST(req, { params });

    const insertCall = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    // raw_payload must be the parsed JSON of the request body, not the Event object
    expect(insertCall.raw_payload).toEqual(STRIPE_EVENT_BODY);
    // Specifically it must carry the top-level 'id' field from the raw body
    expect((insertCall.raw_payload as Record<string, unknown>)['id']).toBe('evt_unique_001');
  });

  it('returns 200 with duplicate:true and does NOT insert again on replay', async () => {
    // Simulate: event already in the table
    mockFrom.mockImplementation(buildFromChain({ id: 'pe_existing', status: 'processed' }));

    const req = makeStripeRequest(STRIPE_EVENT_BODY);
    const params = Promise.resolve({ provider: 'stripe' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);

    // The insert must NOT have been called — dedup happened before it
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('idempotent: replaying the same event_id twice never creates a second row', async () => {

    // First call — event does not exist yet
    mockFrom.mockImplementation(buildFromChain(null));
    const req1 = makeStripeRequest(STRIPE_EVENT_BODY);
    await POST(req1, { params: Promise.resolve({ provider: 'stripe' }) });

    // Second call — event now exists (simulate DB state)
    mockFrom.mockImplementation(buildFromChain({ id: 'pe_existing', status: 'processed' }));
    mockInsert.mockClear();

    const req2 = makeStripeRequest(STRIPE_EVENT_BODY);
    const res2 = await POST(req2, { params: Promise.resolve({ provider: 'stripe' }) });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.duplicate).toBe(true);
    // No second insert
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('handles unique constraint race condition (error code 23505) as safe no-op', async () => {

    // First select says no duplicate, but insert races and hits the unique constraint
    mockFrom.mockImplementation(buildFromChain(null));
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } });

    const req = makeStripeRequest(STRIPE_EVENT_BODY);
    const params = Promise.resolve({ provider: 'stripe' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
  });

  // ── Fix 1: org_id cross-check ─────────────────────────────────────────────

  describe('Fix 1 — org_id cross-check against stripe_customer_id', () => {
    it('flags event and uses customer-derived org when metadata.organization_id disagrees', async () => {
      // verifyStripeWebhook returns an event with metadata org-from-metadata
      // but resolveOrgFromStripeCustomer returns org-from-customer → mismatch → flagged
      vi.mocked(verifyStripeWebhook).mockResolvedValue({
        ...NORMALISED_EVENT,
        providerEventId: 'evt_mismatch_001',
        metadata: { organization_id: 'org-from-metadata' },
      });
      // resolveOrgFromStripeCustomer returns a different org
      mockResolveCustomerOrg.mockResolvedValue('org-from-customer');

      mockFrom.mockImplementation(buildFromChain(null));
      mockInsert.mockResolvedValue({ error: null });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);

      // Insert must use customer-derived org and status='flagged'
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org-from-customer',
          status: 'flagged',
        })
      );
    });

    it('uses customer-derived org when metadata.organization_id is absent', async () => {
      vi.mocked(verifyStripeWebhook).mockResolvedValue({
        ...NORMALISED_EVENT,
        providerEventId: 'evt_no_meta_org_001',
        metadata: {}, // no organization_id in metadata
      });
      mockResolveCustomerOrg.mockResolvedValue('org-from-customer');
      mockFrom.mockImplementation(buildFromChain(null));
      mockInsert.mockResolvedValue({ error: null });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(200);
      // Should use customer-derived org, not flagged (no mismatch — metadata just absent)
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org-from-customer',
          status: 'pending',
        })
      );
    });

    it('stores event with organization_id=NULL when neither metadata nor customer resolves', async () => {
      vi.mocked(verifyStripeWebhook).mockResolvedValue({
        ...NORMALISED_EVENT,
        providerEventId: 'evt_platform_001',
        metadata: {},
      });
      mockResolveCustomerOrg.mockResolvedValue(null); // no customer resolution
      mockFrom.mockImplementation(buildFromChain(null));
      mockInsert.mockResolvedValue({ error: null });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(200);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: null,
          status: 'pending',
        })
      );
    });
  });

  // ── Fix 2: only 'stripe' provider accepted ───────────────────────────────────

  describe('Fix 2 — only stripe provider accepted', () => {
    it('returns 400 for an unknown provider slug', async () => {
      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'fawry' });
      const res = await POST(req, { params });
      expect(res.status).toBe(400);
    });
  });

  // ── Fix 3: Rate limiting ───────────────────────────────────────────────────

  describe('Fix 3 — rate limiting', () => {
    it('returns 429 with Retry-After header when rate limit is exceeded', async () => {
      vi.mocked(webhookCheckRateLimit).mockReturnValue({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 60,
      });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      const body = await res.json();
      expect(body.error).toMatch(/too many requests/i);
    });

    it('allows requests when rate limit has not been exceeded', async () => {
      vi.mocked(webhookCheckRateLimit).mockReturnValue({
        allowed: true,
        remaining: 50,
        retryAfterSeconds: 60,
      });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      // Should proceed past rate limit — signature check etc will happen
      expect(res.status).not.toBe(429);
    });
  });

  // ── Fix 3: in-memory token-bucket unit tests (real module, no mock) ────────

  describe('Fix 3 — webhook-rate-limit module (real implementation)', () => {
    it('allows up to limit requests then blocks the next one', async () => {
      // Import real module (not the mocked version in route tests)
      const { webhookCheckRateLimit: realCheck, _resetWebhookBucketsForTesting } =
        await vi.importActual<typeof import('@/lib/webhook-rate-limit')>('@/lib/webhook-rate-limit');

      _resetWebhookBucketsForTesting();

      const testIp = 'test-ip-ratelimit';
      // Make 100 requests — all should be allowed
      for (let i = 0; i < 100; i++) {
        const result = realCheck(testIp, { limit: 100, windowMs: 60_000 });
        expect(result.allowed).toBe(true);
      }
      // 101st request — should be blocked
      const blocked = realCheck(testIp, { limit: 100, windowMs: 60_000 });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('resets the window after windowMs has elapsed', async () => {
      const { webhookCheckRateLimit: realCheck, _resetWebhookBucketsForTesting } =
        await vi.importActual<typeof import('@/lib/webhook-rate-limit')>('@/lib/webhook-rate-limit');

      _resetWebhookBucketsForTesting();

      // Spy on Date.now to simulate time advancing
      const now = Date.now();
      const dateSpy = vi.spyOn(Date, 'now');

      // Fill up the bucket
      dateSpy.mockReturnValue(now);
      for (let i = 0; i < 100; i++) {
        realCheck('window-reset-ip', { limit: 100, windowMs: 60_000 });
      }
      const blocked = realCheck('window-reset-ip', { limit: 100, windowMs: 60_000 });
      expect(blocked.allowed).toBe(false);

      // Advance time past the window
      dateSpy.mockReturnValue(now + 61_000);
      const allowed = realCheck('window-reset-ip', { limit: 100, windowMs: 60_000 });
      expect(allowed.allowed).toBe(true);

      dateSpy.mockRestore();
    });
  });

  // ── Fix 4: non-dup insert error → 200 + dead-letter ─────────────────────

  describe('Fix 4 — non-dup insert error returns 200 and writes failed row', () => {
    it('returns 200 (not 500) when insert fails with a non-23505 error', async () => {
      mockFrom.mockImplementation(buildFromChain(null));

      // First insert fails with a non-dup error; second (dead-letter) succeeds
      mockInsert
        .mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied' } })
        .mockResolvedValueOnce({ error: null });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(body.dead_lettered).toBe(true);
    });

    it('attempts to write a dead-letter failed row on persistent insert error', async () => {
      mockFrom.mockImplementation(buildFromChain(null));

      mockInsert
        .mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied' } })
        .mockResolvedValueOnce({ error: null });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      await POST(req, { params });

      // Two insert calls: original attempt + dead-letter attempt
      expect(mockInsert).toHaveBeenCalledTimes(2);

      // Dead-letter row must have status='failed' and a synthetic event_id
      const deadLetterCall = mockInsert.mock.calls[1][0] as Record<string, unknown>;
      expect(deadLetterCall.status).toBe('failed');
      expect(String(deadLetterCall.provider_event_id)).toContain('__failed_');
    });

    it('still returns 200 even when the dead-letter insert also fails', async () => {
      mockFrom.mockImplementation(buildFromChain(null));

      // Both inserts fail
      mockInsert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });

      const req = makeStripeRequest(STRIPE_EVENT_BODY);
      const params = Promise.resolve({ provider: 'stripe' });
      const res = await POST(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
    });
  });
});
