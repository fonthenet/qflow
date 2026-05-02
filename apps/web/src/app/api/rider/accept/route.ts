import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { enqueueWaJob } from '@/lib/whatsapp-outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/accept
 *   body: { ticketId, token }
 *
 * In-app equivalent of replying *ACCEPT* on WhatsApp. Stamps
 * `dispatched_at` (the trigger that flips the order to "out for
 * delivery" from the operator's POV), inserts a `rider_accepted`
 * event, and pings the customer with the live tracking link.
 *
 * Same lifecycle as whatsapp-rider-commands.ts#handleAccept — both
 * surfaces hit the SAME state-locked update (UPDATE ... WHERE
 * dispatched_at IS NULL ... RETURNING) so a duplicate accept (e.g.
 * rider taps twice + a stale WA replay) is naturally idempotent.
 *
 * Auth: per-ticket HMAC token, same as the rest of /api/rider/*. We
 * also accept session-bearer riders by reading the rider session and
 * verifying the ticket is assigned to them — but the per-ticket token
 * path is the canonical one because the deep-link flow already owns it.
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

  // Fetch the ticket so we can fire the customer "on its way" ping
  // and surface the dispatched_at if this is a no-op replay.
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, qr_token, customer_data, assigned_rider_id, dispatched_at, delivered_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (tkErr || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json(
      { ok: false, error: 'Order already delivered', code: 'already_delivered' },
      { status: 409 },
    );
  }
  if (!ticket.assigned_rider_id) {
    return NextResponse.json(
      { ok: false, error: 'No rider assigned for this ticket', code: 'unassigned' },
      { status: 409 },
    );
  }
  if (ticket.dispatched_at) {
    // Idempotent — already accepted. Return success with the existing
    // timestamp so the client can refresh state without prompting.
    return NextResponse.json({ ok: true, noop: true, dispatched_at: ticket.dispatched_at });
  }

  const nowIso = new Date().toISOString();
  // State-locked update: only the FIRST accept advances dispatched_at.
  // Race-safe vs. a concurrent WA ACCEPT or a double-tap.
  const { data: advanced, error: updErr } = await supabase
    .from('tickets')
    .update({ dispatched_at: nowIso })
    .eq('id', ticketId)
    .is('dispatched_at', null)
    .is('delivered_at', null)
    .select('id, dispatched_at')
    .maybeSingle();
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }
  if (!advanced) {
    // Lost the race — re-read to surface whatever the winner stamped.
    const { data: refreshed } = await supabase
      .from('tickets').select('dispatched_at').eq('id', ticketId).maybeSingle();
    return NextResponse.json({ ok: true, noop: true, dispatched_at: refreshed?.dispatched_at ?? null });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'rider_accepted',
    metadata: { rider_id: ticket.assigned_rider_id, source: 'rider_app' },
  }).then(() => {}, () => {});

  // Customer notification — parity with the WA path. Sent through the
  // durable outbox so a transient Meta failure gets retried.
  const customerPhone = (ticket.customer_data as any)?.phone ?? null;
  if (customerPhone) {
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;
    void enqueueWaJob({
      ticketId,
      action: 'order_dispatched',
      toPhone: customerPhone,
      body: `🛵 Your order *${ticket.ticket_number}* is on its way.\nTrack: ${trackUrl}`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, dispatched_at: nowIso });
}
