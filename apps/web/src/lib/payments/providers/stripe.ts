/**
 * Stripe payment provider — full implementation.
 *
 * Security rules:
 * - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are only accessed server-side.
 * - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is safe for the client.
 * - Raw card numbers never touch our code (Stripe Elements / hosted checkout).
 * - Webhook signature is verified with stripe.webhooks.constructEvent before
 *   any state change. Invalid signatures return null — caller returns 400.
 * - Log only last4 + brand, never full PANs.
 */

import Stripe from 'stripe';
import type {
  PaymentProvider,
  PaymentCapabilities,
  CreateCheckoutParams,
  CheckoutResult,
  WebhookEvent,
  RefundParams,
  RefundResult,
} from '../provider';
import { registerProvider } from '../registry';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Supported countries/currencies ────────────────────────────────────────────

/**
 * All 13 seed countries where Stripe appears as a provider.
 * DZD is intentionally excluded from supportedCurrencies — Stripe does not
 * support DZD. When an org is in DZ and Stripe is selected, the caller must
 * use a presentment currency (EUR/USD) or choose a local rail.
 */
const SUPPORTED_COUNTRIES: string[] = [
  'DZ', 'MA', 'TN', 'EG', 'FR', 'US', 'AE', 'SA', 'IN',
  'SN', 'CI', 'NG', 'KE',
];

/**
 * Currencies Stripe supports (intersection with our seed countries).
 * DZD excluded — Stripe does not process DZD.
 */
const SUPPORTED_CURRENCIES: string[] = [
  'USD', 'EUR', 'GBP', 'MAD', 'TND', 'EGP', 'AED', 'SAR',
  'INR', 'XOF', 'NGN', 'KES',
];

const CAPABILITIES: PaymentCapabilities = {
  deposits: true,
  noShowFees: true,
  tipping: true,
  subscriptions: true,
  recurring: true,
  threeDSecure: true,
};

// ── Lazy Stripe client (server-side only) ─────────────────────────────────────

let _stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var is not set');
  _stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' });
  return _stripe;
}

// ── Normalise Stripe event → shared WebhookEvent shape ───────────────────────

function normaliseStripeEvent(event: Stripe.Event): WebhookEvent {
  let amount: number | undefined;
  let currency: string | undefined;
  let reference: string = event.id;
  let metadata: Record<string, string> | undefined;

  const obj = event.data.object as unknown as Record<string, unknown>;

  if (typeof obj['amount'] === 'number') amount = obj['amount'] as number;
  if (typeof obj['amount_received'] === 'number') amount = obj['amount_received'] as number;
  if (typeof obj['currency'] === 'string') currency = (obj['currency'] as string).toUpperCase();
  if (typeof obj['id'] === 'string') reference = obj['id'] as string;
  if (obj['metadata'] && typeof obj['metadata'] === 'object') {
    metadata = obj['metadata'] as Record<string, string>;
  }

  // Map Stripe event type to normalised type
  let type = event.type as string;
  const typeMap: Record<string, string> = {
    'payment_intent.succeeded': 'payment.succeeded',
    'payment_intent.payment_failed': 'payment.failed',
    'payment_intent.canceled': 'payment.cancelled',
    'checkout.session.completed': 'payment.succeeded',
    'checkout.session.expired': 'payment.failed',
    'charge.refunded': 'refund.succeeded',
    'charge.refund.updated': 'refund.updated',
    'customer.subscription.created': 'subscription.created',
    'customer.subscription.updated': 'subscription.updated',
    'customer.subscription.deleted': 'subscription.cancelled',
    'invoice.paid': 'invoice.paid',
    'invoice.payment_failed': 'invoice.payment_failed',
  };
  type = typeMap[type] ?? type;

  return {
    type,
    provider: 'stripe',
    providerEventId: event.id,
    reference,
    amount,
    currency,
    metadata,
    raw: event,
  };
}

// ── Provider implementation ───────────────────────────────────────────────────

const stripeProvider: PaymentProvider = {
  id: 'stripe',
  displayName: { en: 'Stripe', fr: 'Stripe', ar: 'سترايب' },
  supportedCountries: SUPPORTED_COUNTRIES,
  supportedCurrencies: SUPPORTED_CURRENCIES,
  capabilities: CAPABILITIES,
  isImplemented: true,

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const stripe = getStripeClient();
    const {
      amount,
      currency,
      description,
      idempotencyKey,
      returnUrl,
      customer,
      metadata,
      flow,
    } = params;

    // DZD guard — defense-in-depth. This path should be unreachable in
    // production because DZ is cash-only: country_config.payment_providers is
    // empty for DZ, so isCashOnly() returns true and callers never reach
    // createCheckout. The throw is kept as a belt-and-suspenders safeguard in
    // case a future code path bypasses the cash-only gate.
    if (currency.toUpperCase() === 'DZD') {
      throw new Error(
        'Stripe does not support DZD. DZ is currently cash-only — this path should not be reachable via normal UI flows.'
      );
    }

    const intentMetadata: Record<string, string> = {
      ...metadata,
      flow: flow ?? 'one_time',
      qflo_idempotency_key: idempotencyKey,
    };

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        description,
        metadata: intentMetadata,
        ...(returnUrl
          ? { confirmation_method: 'automatic', confirm: false }
          : {}),
        ...(customer?.email ? { receipt_email: customer.email } : {}),
      },
      { idempotencyKey }
    );

    return {
      providerReference: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? undefined,
      raw: { id: paymentIntent.id, status: paymentIntent.status },
    };
  },

  async verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent | null> {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook');
        return null;
      }

      if (!signature) return null;

      const stripe = getStripeClient();
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        console.warn('[stripe] Webhook signature verification failed:', (err as Error).message);
        return null;
      }

      return normaliseStripeEvent(event);
    } catch (err) {
      console.error('[stripe] Unexpected error in verifyWebhook:', err);
      return null;
    }
  },

  async resolveCustomerOrg(event: WebhookEvent, adminClient: unknown): Promise<string | null> {
    try {
      // Extract Stripe customer id from the raw event payload.
      // Most event types (PaymentIntent, Invoice) carry `customer` directly on
      // data.object. Older Charge-based events may nest it under
      // data.object.charges.data[0].customer.
      const raw = event.raw as Stripe.Event | undefined;
      const obj = raw?.data?.object as Record<string, unknown> | undefined;

      let customerId: string | null = null;

      if (typeof obj?.['customer'] === 'string') {
        customerId = obj['customer'] as string;
      } else {
        // Fallback: charges.data[0].customer
        const charges = obj?.['charges'] as Record<string, unknown> | undefined;
        const chargesData = charges?.['data'] as Array<Record<string, unknown>> | undefined;
        const firstCharge = chargesData?.[0];
        if (typeof firstCharge?.['customer'] === 'string') {
          customerId = firstCharge['customer'] as string;
        }
      }

      if (!customerId) return null;

      const supabase = adminClient as SupabaseClient;
      const { data, error } = await supabase
        .from('organizations')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

      if (error) {
        console.error('[stripe] resolveCustomerOrg DB error:', error);
        return null;
      }

      return (data as { id: string } | null)?.id ?? null;
    } catch (err) {
      console.error('[stripe] resolveCustomerOrg unexpected error:', err);
      return null;
    }
  },

  async refund(params: RefundParams): Promise<RefundResult> {
    const stripe = getStripeClient();
    const { providerReference, amount, reason, idempotencyKey } = params;

    const refund = await stripe.refunds.create(
      {
        payment_intent: providerReference,
        ...(amount !== undefined ? { amount } : {}),
        ...(reason ? { reason: reason as Stripe.RefundCreateParams.Reason } : {}),
      },
      { idempotencyKey }
    );

    return {
      providerRefundId: refund.id,
      amount: refund.amount,
      currency: refund.currency.toUpperCase(),
      status:
        refund.status === 'succeeded'
          ? 'succeeded'
          : refund.status === 'failed'
          ? 'failed'
          : 'pending',
      raw: { id: refund.id, status: refund.status },
    };
  },
};

// ── Self-register on import ───────────────────────────────────────────────────

registerProvider(stripeProvider);

export default stripeProvider;
