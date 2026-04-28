import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * POST /api/rider/delivered
 *
 * Rider-side counterpart to /api/orders/delivered. Driver hits the
 * "Delivered" button on the rider portal → we stamp `delivered_at`,
 * flip status to `served`, and send the customer the closing WhatsApp.
 * Mirrors the operator endpoint exactly except for the auth gate
 * (rider token instead of staff Bearer).
 *
 * Idempotent: a second call on a delivered ticket is a no-op.
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

  const supabase = createAdminClient();

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, locale, customer_data, qr_token, office_id, delivered_at, dispatched_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json({ ok: true, noop: true, delivered_at: ticket.delivered_at });
  }
  // Allow delivering even if the operator never dispatched — covers the
  // case where the rider grabs the ticket physically and we never went
  // through the explicit Dispatch button. The status guard below still
  // requires the ticket to be in `serving`, so we won't quietly mark
  // a pending_approval ticket as delivered.
  if (ticket.status !== 'serving') {
    return NextResponse.json(
      { ok: false, error: `Ticket must be in 'serving' status to mark delivered (current: ${ticket.status})`, code: 'wrong_state' },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('tickets')
    .update({
      delivered_at: nowIso,
      completed_at: nowIso,
      status: 'served',
    })
    .eq('id', ticketId)
    .eq('status', 'serving')
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'order_delivered',
    to_status: 'served',
    metadata: { delivered_at: nowIso, dispatched_at: ticket.dispatched_at ?? null, source: 'rider_portal' },
  }).then(() => {}, () => {});

  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (phone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;
    const msg =
      locale === 'ar'
        ? `✅ تم تسليم طلبك *#${ticket.ticket_number}*. شهية طيبة! 🍽️\nالتتبع: ${trackUrl}`
        : locale === 'en'
          ? `✅ Your order *#${ticket.ticket_number}* has been delivered. Enjoy your meal! 🍽️\nTrack: ${trackUrl}`
          : `✅ Votre commande *#${ticket.ticket_number}* a été livrée. Bon appétit ! 🍽️\nSuivi : ${trackUrl}`;
    void sendWhatsAppMessage({ to: phone, body: msg })
      .catch((e) => console.warn('[rider/delivered] WA send failed', e?.message));
  }

  return NextResponse.json({ ok: true, delivered_at: nowIso });
}
