/**
 * Stripe billing client — Qflo SaaS subscription billing ONLY.
 *
 * This module is NOT for B2C customer payments. It handles:
 * - Qflo subscription billing (orgs paying Qflo for the SaaS plan)
 * - Stripe webhook verification for billing events
 * - Resolving organization from Stripe customer ID
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
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Lazy Stripe client (server-side only) ─────────────────────────────────────

let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var is not set');
  _stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' });
  return _stripe;
}

// ── Normalised billing event shape ────────────────────────────────────────────

export interface BillingWebhookEvent {
  /** Normalised event type, e.g. 'payment.succeeded', 'subscription.created' */
  type: string;
  /** Provider-side event ID — used for idempotency dedup */
  providerEventId: string;
  /** Provider-side payment reference */
  reference: string;
  /** Amount in minor units */
  amount?: number;
  /** ISO-4217 currency */
  currency?: string;
  /** Metadata originally passed at checkout creation */
  metadata?: Record<string, string>;
  /** Raw provider payload — stored for audit; never returned to the client */
  raw: unknown;
}

// ── Normalise Stripe event → shared BillingWebhookEvent shape ─────────────────

export function normaliseStripeEvent(event: Stripe.Event): BillingWebhookEvent {
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
    providerEventId: event.id,
    reference,
    amount,
    currency,
    metadata,
    raw: event,
  };
}

// ── Webhook verification ──────────────────────────────────────────────────────

/**
 * Verify an inbound Stripe webhook signature.
 * Returns null when the signature is invalid or the body is unparseable.
 * Must never throw — catches internally.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  signature: string | null
): Promise<BillingWebhookEvent | null> {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[billing/stripe] STRIPE_WEBHOOK_SECRET is not set');
      return null;
    }
    if (!signature) return null;

    const stripe = getStripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.warn('[billing/stripe] Webhook signature verification failed:', (err as Error).message);
      return null;
    }

    return normaliseStripeEvent(event);
  } catch (err) {
    console.error('[billing/stripe] Unexpected error in verifyStripeWebhook:', err);
    return null;
  }
}

// ── Org resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the Qflo organization_id from a Stripe customer ID embedded in a
 * billing event. Used to cross-check metadata.organization_id against the
 * authoritative DB record.
 */
export async function resolveOrgFromStripeCustomer(
  event: BillingWebhookEvent,
  supabase: SupabaseClient
): Promise<string | null> {
  try {
    const raw = event.raw as Stripe.Event | undefined;
    const obj = raw?.data?.object as Record<string, unknown> | undefined;

    let customerId: string | null = null;

    if (typeof obj?.['customer'] === 'string') {
      customerId = obj['customer'] as string;
    } else {
      const charges = obj?.['charges'] as Record<string, unknown> | undefined;
      const chargesData = charges?.['data'] as Array<Record<string, unknown>> | undefined;
      const firstCharge = chargesData?.[0];
      if (typeof firstCharge?.['customer'] === 'string') {
        customerId = firstCharge['customer'] as string;
      }
    }

    if (!customerId) return null;

    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (error) {
      console.error('[billing/stripe] resolveOrgFromStripeCustomer DB error:', error);
      return null;
    }

    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.error('[billing/stripe] resolveOrgFromStripeCustomer unexpected error:', err);
    return null;
  }
}

export default getStripeClient;
