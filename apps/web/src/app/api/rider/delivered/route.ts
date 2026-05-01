import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { buildOrderReceiptMessage } from '@/lib/order-receipt';

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

  // Run finished — drop the rider's push token so subsequent state
  // changes don't ping a now-irrelevant device.
  void import('@/lib/rider-push').then(({ clearRiderPushToken }) =>
    clearRiderPushToken(ticketId),
  ).catch(() => {});

  // Customer notification status — flipped to true when the WA
  // delivery confirmation is accepted by Meta. Flowed back to the
  // rider portal so the driver sees explicit success/failure.
  let notified = false;
  let notifyError: string | null = null;

  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (phone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;

    const { data: office } = await supabase
      .from('offices').select('name, organization_id').eq('id', ticket.office_id).maybeSingle();
    let orgName = office?.name ?? '';
    if (office?.organization_id) {
      const { data: org } = await supabase
        .from('organizations').select('name').eq('id', office.organization_id).maybeSingle();
      if (org?.name) orgName = org.name;
    }

    const headerLine =
      locale === 'ar'
        ? `✅ تم تسليم طلبك *#${ticket.ticket_number}*. شهية طيبة! 🍽️`
        : locale === 'en'
          ? `✅ Your order *#${ticket.ticket_number}* has been delivered. Enjoy your meal! 🍽️`
          : `✅ Votre commande *#${ticket.ticket_number}* a été livrée. Bon appétit ! 🍽️`;

    // Await the send so we can return the actual delivery status to
    // the rider portal — earlier we fire-and-forgot, which meant
    // silent WA failures looked like success on the rider's screen.
    // Now if Meta rejects the send (rate limit, 24h window, opt-out)
    // the rider sees an explicit "Customer not reached" indicator
    // and can call the customer manually instead.
    let waBody: string;
    try {
      waBody = await buildOrderReceiptMessage(supabase, {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        orgName,
        locale,
        headerLine,
        trackUrl,
      });
    } catch (e: any) {
      console.warn('[rider/delivered] receipt build failed, falling back', e?.message);
      waBody = `${headerLine}\n${trackUrl}`;
    }

    // Route through the outbox. enqueueWaJob attempts an inline send
    // and falls back to cron-driven retries on failure (5 attempts,
    // exponential backoff). The 'delivered' result reflects that
    // first attempt — we still flow it back to the rider portal so
    // the driver sees a green "Customer notified" indicator on
    // success or amber "please confirm by phone" on first-attempt
    // failure (the cron will keep trying in the background).
    const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
    try {
      const r = await enqueueWaJob({
        ticketId,
        action: 'order_delivered',
        toPhone: phone,
        body: waBody,
      });
      notified = r.delivered;
      notifyError = r.lastError ?? null;
    } catch (e: any) {
      notifyError = e?.message ?? 'unknown';
    }

    // Audit trail in ticket_events so the operator can see whether
    // the customer was actually notified on the FIRST attempt. The
    // outbox table itself is the canonical retry log.
    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: notified ? 'customer_notified' : 'customer_notify_pending',
      metadata: notified
        ? { channel: 'whatsapp', phone, source: 'rider_portal' }
        : { channel: 'whatsapp', phone, error: notifyError, source: 'rider_portal', will_retry: true },
    }).then(() => {}, () => {});
  }

  return NextResponse.json({
    ok: true,
    delivered_at: nowIso,
    notified,
    notify_error: notifyError,
  });
}
