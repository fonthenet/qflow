/**
 * Dynamic webhook router: /api/payments/webhooks/[provider]
 *
 * Currently handles Stripe billing webhooks (Qflo SaaS subscription events).
 * B2C customer payment webhooks are handled via org_payment_methods (BYO model).
 *
 * Design rules:
 * - Uses the admin (service-role) Supabase client — webhooks arrive without
 *   cookies/session tokens so the cookie-bound server client is useless here.
 * - Idempotent: checks (provider, provider_event_id) unique constraint before
 *   writing — duplicate deliveries are safe no-ops.
 * - Signature verification delegated to verifyStripeWebhook().
 * - Raw body captured once before verification and stored as jsonb `raw_payload`.
 *
 * Security hardening:
 * Fix 1 (HIGH)  — organization_id cross-checked against stripe_customer_id.
 * Fix 2 (HIGH)  — Only 'stripe' provider accepted; unknown providers → 400.
 * Fix 3 (MEDIUM) — In-memory IP rate limiting (100 req/60 s per IP).
 * Fix 4 (MEDIUM) — Non-dup insert errors return 200 + write 'failed' row
 *                  (dead-letter queue) instead of 500 + infinite Stripe retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeWebhook, resolveOrgFromStripeCustomer } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { extractWebhookIp, webhookCheckRateLimit } from '@/lib/webhook-rate-limit';

export const runtime = 'nodejs'; // Required for Stripe's crypto-based verification

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  // ── Fix 3: Rate limiting ────────────────────────────────────────────────────
  const ip = extractWebhookIp(req.headers);
  const rateResult = webhookCheckRateLimit(ip);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateResult.retryAfterSeconds) },
      }
    );
  }

  const { provider: providerId } = await params;

  // Fix 2: Only Stripe billing webhooks are accepted here.
  if (providerId !== 'stripe') {
    console.warn(`[webhook-router] Unknown provider: ${providerId}`);
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }

  // 1. Read the raw body once — needed for both signature verification and audit storage.
  const rawBody = await req.text();

  // 2. Verify signature
  const signatureHeader = req.headers.get('stripe-signature');
  const event = await verifyStripeWebhook(rawBody, signatureHeader);
  if (!event) {
    console.warn(`[webhook-router] Signature verification failed for provider: ${providerId}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 3. Idempotency check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  const { data: existing } = await supabase
    .from('payment_events')
    .select('id, status')
    .eq('provider', 'stripe')
    .eq('provider_event_id', event.providerEventId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 4. Fix 1: Cross-check organization_id
  const metadataOrgId: string | null = event.metadata?.organization_id ?? null;
  let resolvedOrgId: string | null = null;
  let orgMismatchFlagged = false;

  resolvedOrgId = await resolveOrgFromStripeCustomer(event, supabase);

  let organizationId: string | null;

  if (resolvedOrgId && metadataOrgId && resolvedOrgId !== metadataOrgId) {
    console.warn(
      `[webhook-router] SECURITY: org_id mismatch for ${event.providerEventId}. ` +
      `metadata claimed "${metadataOrgId}", customer resolved "${resolvedOrgId}". ` +
      `Trusting customer-derived id and flagging the event.`
    );
    organizationId = resolvedOrgId;
    orgMismatchFlagged = true;
  } else if (resolvedOrgId) {
    organizationId = resolvedOrgId;
  } else {
    organizationId = metadataOrgId;
    if (!organizationId) {
      console.info(
        `[webhook-router] Event ${event.providerEventId} has no resolvable org ` +
        `(platform-level event). Storing with organization_id=NULL.`
      );
    }
  }

  // 5. Parse raw body to jsonb for storage.
  let rawPayloadJson: Json;
  try {
    rawPayloadJson = JSON.parse(rawBody) as Json;
  } catch {
    rawPayloadJson = { _raw: rawBody };
  }

  const initialStatus = orgMismatchFlagged ? 'flagged' : 'pending';

  // 6. Insert the event
  const { error: insertError } = await supabase.from('payment_events').insert({
    provider: 'stripe',
    provider_event_id: event.providerEventId,
    organization_id: organizationId,
    event_type: event.type,
    amount: event.amount ?? null,
    currency: event.currency ?? null,
    metadata: event.metadata ?? null,
    raw_payload: rawPayloadJson,
    status: initialStatus,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.error(
      `[webhook-router] ALERT: Failed to insert payment_event. ` +
      `provider=stripe event_id=${event.providerEventId} ` +
      `error_code=${insertError.code} error=${insertError.message}`
    );

    const failedInsert = await supabase.from('payment_events').insert({
      provider: 'stripe',
      provider_event_id: `${event.providerEventId}__failed_${Date.now()}`,
      organization_id: organizationId,
      event_type: event.type,
      amount: event.amount ?? null,
      currency: event.currency ?? null,
      metadata: {
        ...(event.metadata ?? {}),
        _insert_error_code: insertError.code,
        _insert_error_message: insertError.message,
      },
      raw_payload: rawPayloadJson,
      status: 'failed',
    });

    if (failedInsert.error) {
      console.error(
        `[webhook-router] ALERT: Dead-letter insert also failed for ${event.providerEventId}:`,
        failedInsert.error
      );
    }

    return NextResponse.json({ received: true, dead_lettered: true });
  }

  if (!orgMismatchFlagged) {
    await supabase
      .from('payment_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('provider', 'stripe')
      .eq('provider_event_id', event.providerEventId);
  }

  return NextResponse.json({ received: true });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
