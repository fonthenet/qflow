import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { buildOrderReceiptMessage } from '@/lib/order-receipt';

/**
 * POST /api/orders/delivered
 *
 * Final transition for a delivery order: rider (or operator) marks it as
 * delivered. We stamp `delivered_at`, flip `status` to `served` (matches
 * the "completed" terminal state used by all other ticket flows), and
 * fire a closing WhatsApp message to the customer.
 *
 * Auth mirrors /api/orders/dispatch.
 *
 * Body: { ticketId: string }
 *
 * Idempotent: a second call on an already-delivered ticket is a no-op.
 */

async function authenticateRequest(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return true;
  if (webhookSecret && safeCompare(token, webhookSecret)) return true;
  return token.split('.').length === 3;
}

export async function POST(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ticketId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.ticketId) return NextResponse.json({ ok: false, error: 'ticketId required' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, locale, customer_data, qr_token, office_id, delivered_at, dispatched_at')
    .eq('id', body.ticketId)
    .maybeSingle();
  if (tkErr || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    // Idempotent: already delivered.
    return NextResponse.json({ ok: true, noop: true, delivered_at: ticket.delivered_at });
  }
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
    .eq('id', body.ticketId)
    .eq('status', 'serving')
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // Lifecycle event.
  await supabase.from('ticket_events').insert({
    ticket_id: body.ticketId,
    event_type: 'order_delivered',
    to_status: 'served',
    metadata: { delivered_at: nowIso, dispatched_at: ticket.dispatched_at ?? null },
  }).then(() => {}, () => {});

  // ── Customer WhatsApp — closing receipt ─────────────────────────
  // Sends a full itemised receipt as the final touchpoint so the
  // customer has a record of what they paid for (mirrors the printed
  // receipt at a regular restaurant). Best-effort: WA send failure
  // does NOT roll back the delivery.
  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (phone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;

    // Office name lookup for the receipt header.
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

    try {
      const receiptBody = await buildOrderReceiptMessage(supabase, {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        orgName,
        locale,
        headerLine,
        trackUrl,
      });
      void sendWhatsAppMessage({ to: phone, body: receiptBody })
        .catch((e) => console.warn('[orders/delivered] WA send failed', e?.message));
    } catch (e: any) {
      console.warn('[orders/delivered] receipt build failed, falling back to short message', e?.message);
      const fallback = `${headerLine}\n${trackUrl}`;
      void sendWhatsAppMessage({ to: phone, body: fallback })
        .catch((e) => console.warn('[orders/delivered] fallback WA send failed', e?.message));
    }
  }

  return NextResponse.json({ ok: true, delivered_at: nowIso });
}
