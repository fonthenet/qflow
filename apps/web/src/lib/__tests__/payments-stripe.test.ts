/**
 * Regression tests for lib/payments/providers/stripe.ts
 *
 * Covers:
 * - createCheckout throws for DZD currency (Stripe does not process DZD)
 * - verifyWebhook returns null on bad signature
 * - verifyWebhook returns normalised WebhookEvent on valid signature
 *
 * The Stripe SDK is mocked — no network calls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// ── Mock the Stripe SDK before importing provider ─────────────────────────────

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

// Now import the provider (after mock is set up)
import stripeProvider from '@/lib/payments/providers/stripe';

// ── Helpers ───────────────────────────────────────────────────────────────────

// verifyWebhook now takes (rawBody: string, signature: string | null) directly.
// No Request object needed.

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

// ── createCheckout ─────────────────────────────────────────────────────────────

describe('stripeProvider.createCheckout', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stub_key');
    mockPaymentIntentsCreate.mockReset();
    mockPaymentIntentsCreate.mockResolvedValue({
      id: 'pi_test_new',
      status: 'requires_payment_method',
      client_secret: 'pi_test_new_secret_xyz',
    });
  });

  it('throws when currency is DZD — Stripe does not process DZD', async () => {
    await expect(
      stripeProvider.createCheckout({
        amount: 10000,
        currency: 'DZD',
        idempotencyKey: 'idem-001',
      })
    ).rejects.toThrow(/DZD/i);
  });

  it('throws when currency is dzd (lowercase) — case-insensitive guard', async () => {
    await expect(
      stripeProvider.createCheckout({
        amount: 10000,
        currency: 'dzd',
        idempotencyKey: 'idem-002',
      })
    ).rejects.toThrow(/DZD/i);
  });

  it('creates a payment intent for EUR without error', async () => {
    const result = await stripeProvider.createCheckout({
      amount: 5000,
      currency: 'EUR',
      description: 'Appointment deposit',
      idempotencyKey: 'idem-003',
    });
    expect(result.providerReference).toBe('pi_test_new');
    expect(result.clientSecret).toBe('pi_test_new_secret_xyz');
    expect(mockPaymentIntentsCreate).toHaveBeenCalledOnce();
  });

  it('passes idempotencyKey to the Stripe call', async () => {
    await stripeProvider.createCheckout({
      amount: 1000,
      currency: 'USD',
      idempotencyKey: 'idem-key-unique',
    });
    const call = (mockPaymentIntentsCreate as MockedFunction<typeof mockPaymentIntentsCreate>).mock.calls[0];
    // Second arg to paymentIntents.create is the options object with idempotencyKey
    expect(call[1]).toEqual(expect.objectContaining({ idempotencyKey: 'idem-key-unique' }));
  });
});

// ── verifyWebhook ──────────────────────────────────────────────────────────────

describe('stripeProvider.verifyWebhook', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stub_key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');
    mockConstructEvent.mockReset();
  });

  it('returns null on bad signature', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload.');
    });

    const result = await stripeProvider.verifyWebhook('{"bad":"json"}', 'bad-signature');
    expect(result).toBeNull();
  });

  it('returns null when stripe-signature header is missing (null passed)', async () => {
    const result = await stripeProvider.verifyWebhook('{}', null);
    expect(result).toBeNull();
  });

  it('returns normalised WebhookEvent on a valid payment_intent.succeeded event', async () => {
    mockConstructEvent.mockReturnValue(VALID_STRIPE_EVENT);

    const rawBody = JSON.stringify(VALID_STRIPE_EVENT);
    const result = await stripeProvider.verifyWebhook(rawBody, 't=123,v1=valid');

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('stripe');
    expect(result?.type).toBe('payment.succeeded');
    expect(result?.providerEventId).toBe('evt_test_123');
    expect(result?.reference).toBe('pi_test_456');
    expect(result?.amount).toBe(5000);
    expect(result?.currency).toBe('EUR'); // normalised to uppercase
    expect(result?.metadata).toEqual({ qflo_booking_id: 'bk_abc' });
  });

  it('returns null when STRIPE_WEBHOOK_SECRET env var is not set', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const result = await stripeProvider.verifyWebhook('{}', 't=123,v1=anything');
    expect(result).toBeNull();
  });
});
