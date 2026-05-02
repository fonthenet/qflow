import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { enqueueWaJob } from '@/lib/whatsapp-outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/pickup
 *   body: { ticketId, token }
 *
 * Stamps `tickets.picked_up_at` when the rider physically collects the
 * order from the pickup location (restaurant / office / branch). This is
 * the third stage of the 5-stage lifecycle:
 *
 *   pending → dispatched_at → picked_up_at → arrived_at → delivered_at
 *
 * Idempotent: a second call returns the existing timestamp with noop:true.
 * State-locked: uses WHERE picked_up_at IS NULL so concurrent duplicates
 * (double-tap, Meta webhook replay) collapse safely.
 *
 * Customer ping: locale-aware WhatsApp message through the durable outbox.
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

  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, qr_token, customer_data, locale, status, dispatched_at, picked_up_at, delivered_at')
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
  if (!ticket.dispatched_at) {
    return NextResponse.json(
      { ok: false, error: 'Order has not been accepted by rider yet', code: 'not_accepted' },
      { status: 409 },
    );
  }
  if (ticket.picked_up_at) {
    // Idempotent — already stamped. Surface the existing timestamp.
    return NextResponse.json({ ok: true, noop: true, picked_up_at: ticket.picked_up_at });
  }

  // State-locked update: only the first caller advances picked_up_at.
  const nowIso = new Date().toISOString();
  const { data: advanced, error: updErr } = await supabase
    .from('tickets')
    .update({ picked_up_at: nowIso })
    .eq('id', ticketId)
    .is('picked_up_at', null)
    .is('delivered_at', null)
    .select('id, picked_up_at')
    .maybeSingle();

  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  if (!advanced) {
    // Lost the race to a concurrent request — re-fetch and return the
    // winner's timestamp so the client stays in sync.
    const { data: refreshed } = await supabase
      .from('tickets')
      .select('picked_up_at')
      .eq('id', ticketId)
      .maybeSingle();
    return NextResponse.json({ ok: true, noop: true, picked_up_at: refreshed?.picked_up_at ?? null });
  }

  // Persist the event for the timeline view.
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'rider_picked_up',
    metadata: { source: 'rider_app' },
  }).then(() => {}, () => {});

  // Customer notification — locale-aware, routed through durable outbox.
  const customerPhone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (customerPhone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale as 'ar' | 'en' | 'fr'
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;
    const number = ticket.ticket_number;
    const msg =
      locale === 'ar'
        ? `🛵 السائق استلم طلبك *#${number}* وهو في الطريق إليك.\nالتتبع: ${trackUrl}`
        : locale === 'en'
          ? `🛵 Your driver picked up order *#${number}* and is on the way.\nTrack: ${trackUrl}`
          : `🛵 Votre livreur a récupéré la commande *#${number}* et est en route.\nSuivi : ${trackUrl}`;

    void enqueueWaJob({
      ticketId,
      action: 'order_picked_up',
      toPhone: customerPhone,
      body: msg,
    }).catch((e) => console.warn('[rider/pickup] enqueue failed', e?.message));
  }

  return NextResponse.json({ ok: true, picked_up_at: advanced.picked_up_at });
}
