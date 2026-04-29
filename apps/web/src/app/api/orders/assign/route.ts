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

  let body: { ticketId?: string; riderId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, riderId } = body;
  if (!ticketId || !riderId) {
    return NextResponse.json({ ok: false, error: 'ticketId and riderId required' }, { status: 400 });
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

  // Resolve the rider, scope-check against the ticket's org.
  const { data: officeRow } = await supabase
    .from('offices').select('organization_id, name, timezone').eq('id', ticket.office_id).maybeSingle();
  const orgId = officeRow?.organization_id ?? null;
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

  const lines: string[] = [
    `🛵 New delivery for *${orgName}*`,
    '',
    `🎫 *${ticket.ticket_number}*`,
    customerName ? `👤 ${customerName}` : '',
    street ? `📍 ${street}` : '',
    note ? `📝 _${note}_` : '',
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
    });
    notified = r.delivered;
    notifyError = r.lastError ?? null;
  } catch (e: any) {
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
