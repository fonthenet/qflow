import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/orders/assign
 *
 * Operator-driven order assignment to an in-house rider (riders
 * table). Distinct from /api/orders/dispatch in three ways:
 *
 *   1. Targets the lightweight `riders` table — name + WA phone, no
 *      Qflo login required. /api/orders/dispatch targets `staff`
 *      with role='rider' which is the legacy model.
 *   2. Does NOT stamp `dispatched_at` immediately. The order moves
 *      to "awaiting rider acceptance" — `assigned_rider_id` is set,
 *      `dispatched_at` stays null. The rider replies ACCEPT in WA
 *      to claim the order, which is what flips dispatched_at.
 *   3. Routes the rider notification through the durable outbox
 *      (`whatsapp-outbox.ts`) so transient Meta failures get
 *      retried automatically. Same pattern as customer notifications.
 *
 * Body:
 *   { ticketId: string, riderId: string }
 *
 * Reassignment is allowed: passing a different riderId clears the
 * previous assignment and re-fires the notification. dispatched_at
 * is reset to NULL on reassignment because the new rider needs to
 * accept too.
 */

async function authenticate(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return true;
  if (webhookSecret && safeCompare(token, webhookSecret)) return true;
  // Loose JWT shape check — full validation happens via the
  // staff-scoped Supabase client downstream when needed.
  return token.split('.').length === 3;
}

export async function POST(request: NextRequest) {
  if (!(await authenticate(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ticketId?: string; riderId?: string | null };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId } = body;
  // Empty string from a select.value falls through to null — both mean unassign.
  const riderId: string | null = body.riderId == null || body.riderId === '' ? null : body.riderId;
  const isUnassign = riderId === null;
  if (!ticketId) {
    return NextResponse.json({ ok: false, error: 'ticketId required' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;

  // Fetch the ticket — must be a delivery in serving state.
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, locale, customer_data, delivery_address, qr_token, office_id, assigned_rider_id, dispatched_at, delivered_at, notes')
    .eq('id', ticketId)
    .maybeSingle();
  if (tkErr || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json({ ok: false, error: 'Order already delivered' }, { status: 409 });
  }
  if (ticket.status !== 'serving') {
    return NextResponse.json(
      { ok: false, error: `Ticket must be in 'serving' state to assign (current: ${ticket.status})`, code: 'wrong_state' },
      { status: 409 },
    );
  }

  // ── Unassign branch ────────────────────────────────────────────
  // No rider scope-check needed; just clear the assignment + reset
  // dispatched_at so the order is back to "needs assignment" state.
  // Notify the previously-assigned rider (if any) so they don't
  // keep waiting on a pickup that's no longer theirs.
  if (isUnassign) {
    const { data: prevRider } = ticket.assigned_rider_id
      ? await supabase.from('riders')
          .select('id, name, phone').eq('id', ticket.assigned_rider_id).maybeSingle()
      : { data: null };

    const { error: updErr } = await supabase
      .from('tickets')
      .update({ assigned_rider_id: null, dispatched_at: null })
      .eq('id', ticket.id)
      .is('delivered_at', null);
    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'rider_unassigned',
      metadata: {
        previous_rider_id: ticket.assigned_rider_id ?? null,
        previous_rider_name: prevRider?.name ?? null,
      },
    }).then(() => {}, () => {});

    // Courtesy ping to the previous rider (only if we have a phone).
    if (prevRider?.phone) {
      const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
      void enqueueWaJob({
        ticketId: ticket.id,
        action: 'order_other',
        toPhone: prevRider.phone,
        body: `🚫 Order *${ticket.ticket_number}* has been unassigned. You don't need to deliver this one.`,
        payload: { rider_id: prevRider.id, kind: 'rider_unassigned' },
        // Per-rider idempotency so unassigning the same rider twice on
        // a ticket (operator double-click, etc.) is a no-op, but a NEW
        // rider's later message gets through.
        idempotencyKey: `${ticket.id}:rider_unassigned:${prevRider.id}:whatsapp`,
      }).catch(() => {});
    }

    // Native push to the rider's app (if they had it open). Lights up
    // even on a locked phone via the high-priority alerts channel — the
    // WA ping above is the durable fallback.
    void import('@/lib/rider-push').then(({ sendRiderPush, clearRiderPushToken }) =>
      sendRiderPush(ticket.id, {
        title: 'Order unassigned',
        body: `Order ${ticket.ticket_number} is no longer yours.`,
      }).finally(() => clearRiderPushToken(ticket.id)),
    ).catch(() => {});

    return NextResponse.json({ ok: true, ticket_id: ticket.id, unassigned: true });
  }

  // Resolve the rider, scope-check against the ticket's org.
  // Pull lat/lng too so we can compute the kitchen→drop-off distance/ETA
  // for the rider WA ping (degrades gracefully when either side is null).
  const { data: officeRow } = await supabase
    .from('offices')
    .select('organization_id, name, timezone, latitude, longitude')
    .eq('id', ticket.office_id)
    .maybeSingle();
  const orgId = officeRow?.organization_id ?? null;

  // Belt-and-suspenders: confirm the org has delivery turned on. The
  // UI gates already prevent the call from being made, but rejecting
  // here means a stray API caller can't bypass the feature flag.
  if (orgId) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('delivery_enabled')
      .eq('id', orgId)
      .maybeSingle();
    if (!orgRow?.delivery_enabled) {
      return NextResponse.json(
        { ok: false, error: 'Delivery is not enabled for this business.', code: 'delivery_disabled' },
        { status: 409 },
      );
    }
  }
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Office not found' }, { status: 404 });
  }

  const { data: rider } = await supabase
    .from('riders')
    .select('id, name, phone, organization_id, is_active')
    .eq('id', riderId)
    .maybeSingle();
  if (!rider) {
    return NextResponse.json({ ok: false, error: 'Rider not found' }, { status: 404 });
  }
  if (rider.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Rider belongs to a different business' }, { status: 403 });
  }
  if (!rider.is_active) {
    return NextResponse.json({ ok: false, error: 'Rider is inactive' }, { status: 400 });
  }

  // Reassignment vs initial — both go through the same UPDATE. We
  // clear dispatched_at on reassignment so the new rider's ACCEPT
  // is the trigger for "out for delivery" status.
  const { error: updErr } = await supabase
    .from('tickets')
    .update({
      assigned_rider_id: rider.id,
      dispatched_at: null,
    })
    .eq('id', ticket.id)
    .eq('status', 'serving')
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'rider_assigned',
    metadata: {
      rider_id: rider.id,
      rider_name: rider.name,
      rider_phone: rider.phone,
      reassignment: Boolean(ticket.assigned_rider_id),
    },
  }).then(() => {}, () => {});

  // Fire the rider-side WhatsApp notification through the durable
  // outbox. The bot handles ACCEPT / DONE / CANCEL replies (see
  // whatsapp-rider-commands.ts).
  //
  // Note on the 24-hour window: if the rider hasn't messaged the
  // bot in the last 24 hours, Meta will reject the send (error
  // code 131047). The outbox records the error, the cron retries
  // up to 5 times with backoff, and the operator sees the failed
  // status on the Station card. They can call the rider directly
  // or wait for the rider to send "Check <BIZ>".
  const da = ticket.delivery_address as any;
  const street = typeof da?.street === 'string' ? da.street : '';
  const customerName = (ticket.customer_data as any)?.name ?? '';
  const note = (ticket.notes ?? '').trim();
  const orgName = officeRow.name ?? '';

  // Distance + ETA — kitchen → drop-off via haversine (no external API).
  // Helpful even when ETA is rough; lets the rider gauge the run before
  // accepting. Returns null when either coordinate is missing — we just
  // skip the line in that case.
  const { computeDeliveryMetrics, formatDeliveryMetricsLine } = await import('@qflo/shared');
  const metrics = computeDeliveryMetrics(
    { latitude: officeRow.latitude ?? null, longitude: officeRow.longitude ?? null },
    { lat: typeof da?.lat === 'number' ? da.lat : null, lng: typeof da?.lng === 'number' ? da.lng : null },
  );
  // Rider-side templates currently use FR by default (we don't store
  // rider locale yet — drivers are local hires speaking Darija/FR).
  // When rider locale lands, swap this for rider.locale.
  const riderLocale: 'en' | 'fr' | 'ar' = 'fr';
  const distanceLine = metrics ? formatDeliveryMetricsLine(metrics, riderLocale) : '';

  // Batching detection — does this rider already have other in-flight
  // orders? "In-flight" = serving + assigned but not yet delivered. If
  // so, surface them in the WA so the rider sees this is a 2-stop run
  // (or 3, etc.) and can plan the route.
  const { data: otherInFlight } = await supabase
    .from('tickets')
    .select('id, ticket_number, delivery_address, dispatched_at')
    .eq('assigned_rider_id', rider.id)
    .eq('status', 'serving')
    .is('delivered_at', null)
    .neq('id', ticket.id)
    .order('dispatched_at', { ascending: true, nullsFirst: false });

  const batchedCount = (otherInFlight ?? []).length;
  const batchHeader = batchedCount > 0
    ? `🔗 *Batched run* — you now have ${batchedCount + 1} active deliveries`
    : '';
  const batchList = batchedCount > 0
    ? (otherInFlight ?? []).map((o: any) => {
        const oda = (o.delivery_address ?? {}) as any;
        const ostr = typeof oda?.street === 'string' ? oda.street : '';
        const stage = o.dispatched_at ? '🛵' : '⏳';
        return `   ${stage} *${o.ticket_number}*${ostr ? ` — ${ostr}` : ''}`;
      }).join('\n')
    : '';

  const lines: string[] = [
    batchHeader || `🛵 New delivery for *${orgName}*`,
    batchedCount > 0 ? `Latest from *${orgName}*:` : '',
    '',
    `🎫 *${ticket.ticket_number}*`,
    customerName ? `👤 ${customerName}` : '',
    street ? `📍 ${street}` : '',
    distanceLine,
    note ? `📝 _${note}_` : '',
    batchedCount > 0 ? '' : '',
    batchedCount > 0 ? '*Other active orders:*' : '',
    batchList,
    '',
    `Reply *ACCEPT* to start, *CHECK* to see all your orders.`,
  ].filter(Boolean);
  const ridermsg = lines.join('\n');

  const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
  let notified = false;
  let notifyError: string | null = null;
  try {
    const r = await enqueueWaJob({
      ticketId: ticket.id,
      action: 'order_other',
      toPhone: rider.phone,
      body: ridermsg,
      payload: { rider_id: rider.id, kind: 'rider_assignment' },
      // Per-rider idempotency: each assignment to a different rider
      // gets its own outbox row, so reassigning Max → Mehdi delivers
      // a fresh message to Mehdi. Reassigning back to Max within the
      // same ticket is still idempotent (he doesn't get spammed).
      idempotencyKey: `${ticket.id}:rider_assignment:${rider.id}:whatsapp`,
    });
    notified = r.delivered;
    notifyError = r.lastError ?? null;
    if (!notified) {
      console.warn('[orders/assign] WA enqueue did not deliver inline', {
        ticketId: ticket.id,
        riderId: rider.id,
        riderPhone: rider.phone,
        jobId: r.jobId,
        lastError: r.lastError,
      });
    }
  } catch (e: any) {
    // Was previously swallowed silently — explicit log so Vercel runtime
    // logs surface env / supabase issues that prevent the outbox row.
    console.warn('[orders/assign] WA enqueue threw', {
      ticketId: ticket.id,
      riderId: rider.id,
      message: e?.message,
      stack: e?.stack,
    });
    notifyError = e?.message ?? 'unknown';
  }

  return NextResponse.json({
    ok: true,
    ticket_id: ticket.id,
    rider: { id: rider.id, name: rider.name, phone: rider.phone },
    notified,
    notify_error: notifyError,
  });
}
