/**
 * Dynamic webhook router: /api/payments/webhooks/[provider]
 *
 * Handles inbound webhook events from any registered payment provider.
 * Design rules (per project memory):
 * - Uses the admin (service-role) Supabase client — webhooks arrive without
 *   cookies/session tokens so the cookie-bound server client is useless here.
 *   All reads/writes bypass RLS intentionally; the route performs its own
 *   scope control (idempotency check, then insert + update for that event only).
 * - Idempotent: checks (provider, provider_event_id) unique constraint before
 *   writing — duplicate deliveries (Meta-style re-sends) are safe no-ops.
 * - Signature verification is delegated to provider.verifyWebhook(rawBody, sig);
 *   providers that cannot verify return null → 400.
 * - Raw body captured once before verification and stored as jsonb `raw_payload`
 *   for audit and replay. The Event object is not stored — the raw bytes are.
 * - All state changes happen AFTER signature is verified.
 *
 * Security hardening (2026-04-24):
 * Fix 1 (HIGH)  — organization_id cross-checked against stripe_customer_id.
 * Fix 2 (HIGH)  — Registry guard: only implemented providers accepted.
 * Fix 3 (MEDIUM) — In-memory IP rate limiting (100 req/60 s per IP).
 * Fix 4 (MEDIUM) — Non-dup insert errors return 200 + write 'failed' row
 *                  (dead-letter queue) instead of 500 + infinite Stripe retries.
 */

import { NextRequest, NextResponse } from 'next/server';

// Bootstrap all providers (side-effect registrations)
import '@/lib/payments';
import { getProvider } from '@/lib/payments';
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

  // 1. Look up the provider
  const provider = getProvider(providerId);
  if (!provider) {
    console.warn(`[webhook-router] Unknown provider: ${providerId}`);
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }

  // 2. Read the raw body once — needed for both signature verification and audit storage.
  const rawBody = await req.text();

  // 3. Verify signature using the raw body string and the provider-specific sig header.
  //    Stripe uses 'stripe-signature'; other providers will use their own header names.
  //    Each provider's verifyWebhook is responsible for reading the correct header.
  //    We pass the stripe-signature as the canonical sig header; providers that use
  //    a different header must read it from a passed-through mechanism. For now the
  //    interface passes the stripe-signature as a convenience; non-Stripe providers
  //    return null from stubs regardless.
  const signatureHeader = req.headers.get('stripe-signature');
  const event = await provider.verifyWebhook(rawBody, signatureHeader);
  if (!event) {
    console.warn(`[webhook-router] Signature verification failed for provider: ${providerId}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 4. Idempotency check — resolve org from metadata if present.
  //    Admin client is used here: no session/cookies are available in webhook context
  //    and RLS would block cross-org reads required for the dedup query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  const { data: existing } = await supabase
    .from('payment_events')
    .select('id, status')
    .eq('provider', event.provider)
    .eq('provider_event_id', event.providerEventId)
    .maybeSingle();

  if (existing) {
    // Already processed (or processing) — safe no-op per idempotency rule
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 5. Fix 1: Cross-check organization_id from metadata against the customer-derived org.
  //    Trusting only metadata.organization_id is dangerous — an attacker who forges
  //    Stripe test-mode events could attribute transactions to arbitrary orgs.
  //    Resolution priority:
  //      a) Ask the provider to resolve the org from its customer identifier (DB lookup).
  //      b) Fall back to metadata.organization_id as a hint.
  //    If both exist but disagree → log security warning, trust the customer-derived id,
  //    store the row with status='flagged' for manual review.

  const metadataOrgId: string | null = event.metadata?.organization_id ?? null;
  let resolvedOrgId: string | null = null;
  let orgMismatchFlagged = false;

  if (typeof provider.resolveCustomerOrg === 'function') {
    resolvedOrgId = await provider.resolveCustomerOrg(event, supabase);
  }

  let organizationId: string | null;

  if (resolvedOrgId && metadataOrgId && resolvedOrgId !== metadataOrgId) {
    // Mismatch: customer points to a different org than metadata claims.
    // This could be a forged test-mode event or a metadata mis-configuration.
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
    // No customer resolution — fall back to metadata (or null for platform events)
    organizationId = metadataOrgId;
    if (!organizationId) {
      console.info(
        `[webhook-router] Event ${event.providerEventId} has no resolvable org ` +
        `(platform-level event). Storing with organization_id=NULL.`
      );
    }
  }

  // 6. Parse raw body to jsonb for storage. If parsing fails fall back to a
  //    wrapper object so the column constraint is always satisfied.
  let rawPayloadJson: Json;
  try {
    rawPayloadJson = JSON.parse(rawBody) as Json;
  } catch {
    rawPayloadJson = { _raw: rawBody };
  }

  // 7. Determine initial status
  const initialStatus = orgMismatchFlagged ? 'flagged' : 'pending';

  // 8. Insert the event
  //    Fix 4: on non-dup insert errors, write a 'failed' row (best effort) and
  //    return 200 so Stripe stops retrying. Log at error level for alerting.
  const { error: insertError } = await supabase.from('payment_events').insert({
    provider: event.provider,
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
    // Unique constraint violation = duplicate delivery that slipped through the
    // maybeSingle check (race condition) — still a safe no-op.
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Fix 4: Non-duplicate insert error — log with high severity, attempt to
    // write a 'failed' dead-letter row, then return 200 to stop Stripe retries.
    console.error(
      `[webhook-router] ALERT: Failed to insert payment_event. ` +
      `provider=${event.provider} event_id=${event.providerEventId} ` +
      `error_code=${insertError.code} error=${insertError.message}`
    );

    // Best-effort dead-letter insert with a synthetic event_id to avoid conflicts.
    const failedInsert = await supabase.from('payment_events').insert({
      provider: event.provider,
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

    // Return 200 — Stripe must not retry indefinitely for persistent errors.
    // The failed row (or log) serves as the dead-letter queue for manual replay.
    return NextResponse.json({ received: true, dead_lettered: true });
  }

  // 9. Mark as processed (business logic will be added per event type).
  //    Flagged events are NOT auto-promoted to 'processed' — they require manual review.
  if (!orgMismatchFlagged) {
    await supabase
      .from('payment_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('provider', event.provider)
      .eq('provider_event_id', event.providerEventId);
  }

  return NextResponse.json({ received: true });
}

// Stripe requires the raw body; Next.js streams it automatically in nodejs runtime.
// Reject everything that isn't POST.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
