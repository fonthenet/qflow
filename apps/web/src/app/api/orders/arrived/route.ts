import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * POST /api/orders/arrived
 *
 * Operator-side counterpart to /api/rider/arrived. Used when the
 * operator manages the whole flow from Station and the rider portal
 * isn't being used (small shops, owner-operator). Stamps
 * `tickets.arrived_at`, sends the customer the "🛵 driver has
 * arrived" WhatsApp ping. Idempotent: a second call no-ops.
 *
 * Auth mirrors /api/orders/dispatch — Bearer service-role / webhook
 * secret / staff Supabase JWT.
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

  if (!body.ticketId) {
    return NextResponse.json({ ok: false, error: 'ticketId required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, locale, customer_data, qr_token, office_id, arrived_at, delivered_at, dispatched_at')
    .eq('id', body.ticketId)
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
  if (ticket.status !== 'serving') {
    return NextResponse.json(
      { ok: false, error: `Ticket must be in 'serving' status to mark arrived (current: ${ticket.status})`, code: 'wrong_state' },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('tickets')
    .update({ arrived_at: nowIso } as any)
    .eq('id', body.ticketId)
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: body.ticketId,
    event_type: 'rider_arrived',
    metadata: { arrived_at: nowIso, source: 'station_operator' },
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
        ? `🛵 السائق قد *وصل* إليك بطلب *#${ticket.ticket_number}*. التتبع: ${trackUrl}`
        : locale === 'en'
          ? `🛵 Your driver has *arrived* with order *#${ticket.ticket_number}*. Track: ${trackUrl}`
          : `🛵 Votre livreur est *arrivé* avec la commande *#${ticket.ticket_number}*. Suivi : ${trackUrl}`;
    void sendWhatsAppMessage({ to: phone, body: msg })
      .catch((e) => console.warn('[orders/arrived] WA send failed', e?.message));
  }

  return NextResponse.json({ ok: true, arrived_at: nowIso });
}
