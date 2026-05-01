import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { buildRiderPortalUrl } from '@/lib/rider-token';

/**
 * POST /api/orders/dispatch
 *
 * Operator-driven "out for delivery" transition. Stamps `dispatched_at`,
 * optionally assigns a rider (staff with role='rider'), and sends the
 * customer a WhatsApp message including the rider's name + phone if
 * available so they know who's coming.
 *
 * Auth mirrors /api/ticket-transition: Bearer service-role / webhook secret /
 * staff Supabase JWT.
 *
 * Body:
 *   { ticketId: string, riderId?: string }
 *
 * Idempotent: a second dispatch call on a ticket that's already dispatched
 * is a no-op (returns ok with `noop: true`). Rider reassignment is allowed
 * by passing a different `riderId` — the WA notification fires again so
 * the customer knows the driver changed.
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

  let body: { ticketId?: string; riderId?: string | null };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, riderId } = body;
  if (!ticketId) return NextResponse.json({ ok: false, error: 'ticketId required' }, { status: 400 });

  const supabase = createAdminClient();

  // Load ticket — must be a serving delivery order, not yet delivered.
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, locale, customer_data, qr_token, office_id, dispatched_at, delivered_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (tkErr || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.delivered_at) {
    return NextResponse.json({ ok: false, error: 'Order already delivered', code: 'already_delivered' }, { status: 409 });
  }
  if (ticket.status !== 'serving') {
    return NextResponse.json(
      { ok: false, error: `Ticket must be in 'serving' status to dispatch (current: ${ticket.status})`, code: 'wrong_state' },
      { status: 409 },
    );
  }

  // Belt-and-suspenders: confirm the org has delivery turned on before
  // dispatching. UI gates already prevent the call but this protects
  // against direct API hits from outside the operator surface.
  {
    const { data: officeRow } = await supabase
      .from('offices').select('organization_id').eq('id', ticket.office_id).maybeSingle();
    const ticketOrgId = (officeRow as any)?.organization_id ?? null;
    if (ticketOrgId) {
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('delivery_enabled')
        .eq('id', ticketOrgId)
        .maybeSingle();
      if (!(orgRow as any)?.delivery_enabled) {
        return NextResponse.json(
          { ok: false, error: 'Delivery is not enabled for this business.', code: 'delivery_disabled' },
          { status: 409 },
        );
      }
    }
  }

  // Resolve the rider (if assigning). Org-scope check so an admin can't
  // accidentally assign a rider from another org. tickets has no
  // organization_id column — the org is reachable via offices.
  let riderName: string | null = null;
  let riderPhone: string | null = null;
  if (riderId) {
    const { data: officeRow } = await supabase
      .from('offices').select('organization_id').eq('id', ticket.office_id).maybeSingle();
    const ticketOrgId = officeRow?.organization_id ?? null;
    const { data: rider } = await supabase
      .from('staff')
      .select('id, full_name, phone, role, organization_id, is_active')
      .eq('id', riderId)
      .maybeSingle();
    if (!rider) {
      return NextResponse.json({ ok: false, error: 'Rider not found' }, { status: 404 });
    }
    if (rider.organization_id !== ticketOrgId) {
      return NextResponse.json({ ok: false, error: 'Rider belongs to a different business' }, { status: 403 });
    }
    if (rider.is_active === false) {
      return NextResponse.json({ ok: false, error: 'Rider is inactive' }, { status: 400 });
    }
    if (rider.role !== 'rider') {
      // Allow admin/manager too — small shops where the owner delivers.
      // Reject only roles that are clearly not delivery-capable.
      if (!['rider', 'admin', 'manager'].includes(rider.role)) {
        return NextResponse.json({ ok: false, error: 'Staff member is not a rider' }, { status: 400 });
      }
    }
    riderName = rider.full_name ?? null;
    riderPhone = rider.phone ?? null;
  }

  const nowIso = new Date().toISOString();
  const isFirstDispatch = !ticket.dispatched_at;
  const update: Record<string, unknown> = {
    dispatched_at: ticket.dispatched_at ?? nowIso, // keep first-dispatch timestamp on reassign
  };
  if (riderId !== undefined) update.assigned_rider_id = riderId; // null clears

  const { error: updErr } = await supabase
    .from('tickets')
    .update(update)
    .eq('id', ticketId)
    .eq('status', 'serving')
    .is('delivered_at', null);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // Lifecycle event for the activity feed + audit log.
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'order_dispatched',
    to_status: 'serving',
    metadata: {
      rider_id: riderId ?? null,
      rider_name: riderName,
      reassigned: !isFirstDispatch && Boolean(riderId),
    },
  }).then(() => {}, () => {});

  // ── Customer WhatsApp ───────────────────────────────────────────
  // Locale-aware. Includes rider name + phone if the operator assigned
  // one; otherwise just confirms the order is on its way.
  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  if (phone) {
    const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
      ? ticket.locale
      : 'fr';
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;
    const riderLine = riderName
      ? riderPhone
        ? (locale === 'ar' ? `\nالسائق: *${riderName}* — ${riderPhone}`
          : locale === 'en' ? `\nDriver: *${riderName}* — ${riderPhone}`
          : `\nLivreur : *${riderName}* — ${riderPhone}`)
        : (locale === 'ar' ? `\nالسائق: *${riderName}*`
          : locale === 'en' ? `\nDriver: *${riderName}*`
          : `\nLivreur : *${riderName}*`)
      : '';
    const body =
      locale === 'ar'
        ? `🛵 طلبك *#${ticket.ticket_number}* في الطريق إليك.${riderLine}\nالتتبع: ${trackUrl}`
        : locale === 'en'
          ? `🛵 Your order *#${ticket.ticket_number}* is on its way.${riderLine}\nTrack: ${trackUrl}`
          : `🛵 Votre commande *#${ticket.ticket_number}* est en route.${riderLine}\nSuivi : ${trackUrl}`;
    // Outbox-first send. enqueueWaJob attempts the inline delivery and,
    // if it fails (Meta 5xx, network blip, etc.), the row stays pending
    // and the cron worker retries with exponential backoff for up to
    // 5 attempts. Meta's delivery-status webhook updates the row with
    // the actual delivered/read status — operator sees the truth on
    // the Station card, not "we tried".
    const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
    void enqueueWaJob({
      ticketId,
      action: 'order_dispatched',
      toPhone: phone,
      body,
      payload: { rider_name: riderName, rider_phone: riderPhone },
    }).catch((e) => console.warn('[orders/dispatch] enqueue failed', e?.message));
  }

  // Stateless rider portal URL — Station copies this to the operator's
  // clipboard so they can paste it into a WA chat with the driver.
  // Token is HMAC(ticketId, INTERNAL_WEBHOOK_SECRET) — rotating the
  // secret invalidates every outstanding link.
  const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
  const riderLink = buildRiderPortalUrl(cloudUrl, ticketId);

  return NextResponse.json({
    ok: true,
    dispatched_at: update.dispatched_at,
    rider_id: riderId ?? null,
    rider_name: riderName,
    rider_link: riderLink,
  });
}
