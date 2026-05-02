import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { enqueueWaJob } from '@/lib/whatsapp-outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/decline
 *   body: { ticketId, token }
 *
 * In-app equivalent of replying *CANCEL* on WhatsApp before
 * accepting (or to drop an in-flight assignment back to the
 * restaurant). Clears `assigned_rider_id` + `dispatched_at` so
 * the order returns to the operator's "needs assignment" state.
 *
 * Mirrors whatsapp-rider-commands.ts#handleCancel exactly. We do
 * NOT touch the customer (the operator picks a new rider; THAT
 * triggers the customer ping). We do enqueue a courtesy ping back
 * to the rider's WhatsApp so they have a record of the action.
 */
export async function POST(request: NextRequest) {
  let body: { ticketId?: string; token?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, token } = body;
  if (!ticketId || !token) {
    return NextResponse.json({ ok: false, error: 'ticketId and token required' }, { status: 400 });
  }
  if (!verifyRiderToken(ticketId, token)) {
    return NextResponse.json({ ok: false, error: 'Invalid rider token' }, { status: 401 });
  }

  const supabase = createAdminClient() as any;
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, assigned_rider_id, dispatched_at, delivered_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json(
      { ok: false, error: 'Order already delivered — cannot decline', code: 'already_delivered' },
      { status: 409 },
    );
  }
  if (!ticket.assigned_rider_id) {
    // Nobody to decline. Treat as no-op so a duplicate webhook /
    // double-tap doesn't surface as an error.
    return NextResponse.json({ ok: true, noop: true });
  }

  const previousRiderId = ticket.assigned_rider_id;

  const { error: updErr } = await supabase
    .from('tickets')
    .update({ assigned_rider_id: null, dispatched_at: null })
    .eq('id', ticketId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'rider_cancelled_assignment',
    metadata: { rider_id: previousRiderId, source: 'rider_app' },
  }).then(() => {}, () => {});

  // Drop the rider's per-ticket push token defensively — the run is
  // no longer theirs, so any future state-change push for this ticket
  // (e.g. a different rider gets assigned + customer cancels) shouldn't
  // hit the original device.
  void import('@/lib/rider-push').then(({ clearRiderPushToken }) =>
    clearRiderPushToken(ticketId),
  ).catch(() => {});

  // Courtesy WA receipt to the rider mirroring the WA command path.
  const { data: rider } = await supabase
    .from('riders')
    .select('phone').eq('id', previousRiderId).maybeSingle();
  if (rider?.phone) {
    void enqueueWaJob({
      ticketId,
      action: 'order_other',
      toPhone: rider.phone,
      body: `❌ You declined order *${ticket.ticket_number}*. The restaurant has been notified.`,
      payload: { rider_id: previousRiderId, kind: 'rider_self_cancelled' },
      idempotencyKey: `${ticketId}:rider_decline:${previousRiderId}:whatsapp`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
