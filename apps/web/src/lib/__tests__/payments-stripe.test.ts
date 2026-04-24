/**
 * Regression tests for lib/billing/stripe.ts
 *
 * Covers:
 * - verifyStripeWebhook returns null on bad signature
 * - verifyStripeWebhook returns normalised BillingWebhookEvent on valid signature
 *
 * The Stripe SDK is mocked — no network calls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock the Stripe SDK before importing ──────────────────────────────────────

const mockConstructEvent = vi.fn();
const mockPaymentIntentsCreate = vi.fn();
const mockRefundsCreate = vi.fn();

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      paymentIntents: { create: mockPaymentIntentsCreate },
      refunds: { create: mockRefundsCreate },
      webhooks: { constructEvent: mockConstructEvent },
    })),
  };
});

// Now import after mock is set up
import { verifyStripeWebhook, normaliseStripeEvent } from '@/lib/billing/stripe';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STRIPE_EVENT = {
  id: 'evt_test_123',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_test_456',
      amount: 5000,
      amount_received: 5000,
      currency: 'eur',
      metadata: { qflo_booking_id: 'bk_abc' },
    },
  },
};

// ── verifyStripeWebhook ───────────────────────────────────────────────────────

describe('verifyStripeWebhook', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stub_key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');
    mockConstructEvent.mockReset();
  });

  it('returns null on bad signature', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload.');
    });

    const result = await verifyStripeWebhook('{"bad":"json"}', 'bad-signature');
    expect(result).toBeNull();
  });

  it('returns null when stripe-signature header is missing (null passed)', async () => {
    const result = await verifyStripeWebhook('{}', null);
    expect(result).toBeNull();
  });

  it('returns normalised BillingWebhookEvent on a valid payment_intent.succeeded event', async () => {
    mockConstructEvent.mockReturnValue(VALID_STRIPE_EVENT);

    const rawBody = JSON.stringify(VALID_STRIPE_EVENT);
    const result = await verifyStripeWebhook(rawBody, 't=123,v1=valid');

    expect(result).not.toBeNull();
    expect(result?.type).toBe('payment.succeeded');
    expect(result?.providerEventId).toBe('evt_test_123');
    expect(result?.reference).toBe('pi_test_456');
    expect(result?.amount).toBe(5000);
    expect(result?.currency).toBe('EUR'); // normalised to uppercase
    expect(result?.metadata).toEqual({ qflo_booking_id: 'bk_abc' });
  });

  it('returns null when STRIPE_WEBHOOK_SECRET env var is not set', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const result = await verifyStripeWebhook('{}', 't=123,v1=anything');
    expect(result).toBeNull();
  });
});

// ── normaliseStripeEvent ──────────────────────────────────────────────────────

describe('normaliseStripeEvent', () => {
  it('maps payment_intent.succeeded to payment.succeeded', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = normaliseStripeEvent(VALID_STRIPE_EVENT as any);
    expect(event.type).toBe('payment.succeeded');
  });

  it('normalises currency to uppercase', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const event = normaliseStripeEvent(VALID_STRIPE_EVENT as any);
    expect(event.currency).toBe('EUR');
  });
});
