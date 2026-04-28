import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * POST /api/rider/arrived
 *
 * Rider taps "I've Arrived" on the portal when they reach the customer
 * (curb / building / parking). We stamp `tickets.arrived_at`, send the
 * customer a WhatsApp ping ("driver has arrived"), and the customer's
 * tracking page flips to a "the driver is here" banner. Distinct from
 * /api/rider/delivered which is the final completion stamp — many
 * deliveries have a few-minute gap between "arrived" (rider waiting
 * for buzzer / customer to come down) and "delivered" (food handed over).
 *
 * Idempotent: a second call no-ops. No Station-side action required;
 * the operator's card auto-reflects via realtime on Supabase.
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
    .select('id, ticket_number, status, locale, customer_data, arrived_at, delivered_at, office_id, qr_token')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json({ ok: true, noop: true, reason: 'already_delivered' });
  }
  if ((ticket as any).arrived_at) {
    return NextResponse.json({ ok: true, noop: true, arrived_at: (ticket as any).arrived_at });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('tickets')
    .update({ arrived_at: nowIso } as any)
    .eq('id', ticketId)
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'rider_arrived',
    metadata: { arrived_at: nowIso },
  }).then(() => {}, () => {});

  // Customer ping — locale-aware. Only thing the customer needs to do is
  // come down / open the door, so the message is short and actionable.
  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (phone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;
    const msg =
      locale === 'ar'
        ? `🛵 السائق قد *وصل* إليك بطلب *#${ticket.ticket_number}*. التتبع: ${trackUrl}`
        : locale === 'en'
          ? `🛵 Your driver has *arrived* with order *#${ticket.ticket_number}*. Track: ${trackUrl}`
          : `🛵 Votre livreur est *arrivé* avec la commande *#${ticket.ticket_number}*. Suivi : ${trackUrl}`;
    void sendWhatsAppMessage({ to: phone, body: msg })
      .catch((e) => console.warn('[rider/arrived] WA send failed', e?.message));
  }

  return NextResponse.json({ ok: true, arrived_at: nowIso });
}
