import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import {
  ORDER_DECLINE_REASONS,
  resolveLocalized,
  type OrderDeclineReason,
} from '@qflo/shared';

/**
 * POST /api/orders/transition
 *
 * Operator-driven Accept/Decline for `pending_approval` online orders.
 * The Station UI calls this when staff click Accept or Decline on an
 * online-order card. This endpoint:
 *   - moves the cloud ticket to `serving` (accept) or `cancelled` (decline)
 *   - persists the ETA / decline reason in `notes` and `ticket_events.metadata`
 *   - sends a single locale-aware WhatsApp message to the customer
 *
 * Auth: Bearer JWT (staff Supabase session) or service key, mirroring
 * `/api/ticket-transition`.
 *
 * Body:
 *   { ticketId: string, action: 'accept' | 'decline',
 *     etaMinutes?: number,            // accept only
 *     declineReason?: OrderDeclineReason, declineNote?: string  // decline only
 *   }
 */

async function authenticateRequest(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return true;
  if (webhookSecret && safeCompare(token, webhookSecret)) return true;
  // Accept any well-formed JWT — Station passes the staff session token.
  return token.split('.').length === 3;
}

export async function POST(request: NextRequest) {
  if (!(await authenticateRequest(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    ticketId?: string;
    action?: 'accept' | 'decline';
    etaMinutes?: number;
    declineReason?: OrderDeclineReason;
    declineNote?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, action } = body;
  if (!ticketId) return NextResponse.json({ ok: false, error: 'ticketId required' }, { status: 400 });
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ ok: false, error: 'action must be accept or decline' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Load the ticket — must currently be in pending_approval. Anything else
  // is either a stale double-click or a different status that doesn't go
  // through this endpoint (use /api/ticket-transition for those).
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, qr_token, customer_data, locale, office_id, source')
    .eq('id', ticketId)
    .single();
  if (tkErr || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.status !== 'pending_approval') {
    return NextResponse.json(
      { ok: false, error: `Ticket is not pending_approval (current: ${ticket.status})`, code: 'wrong_state' },
      { status: 409 },
    );
  }

  // Office for branding (used in customer message).
  const { data: office } = await supabase
    .from('offices')
    .select('id, name, timezone')
    .eq('id', ticket.office_id)
    .single();

  const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
    ? ticket.locale
    : 'fr';
  const phone: string | null = (ticket.customer_data as any)?.phone ?? null;
  const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
  const trackUrl = `${cloudUrl}/q/${ticket.qr_token}`;

  if (action === 'accept') {
    const etaMinutes = typeof body.etaMinutes === 'number' && body.etaMinutes >= 5 && body.etaMinutes <= 90
      ? Math.round(body.etaMinutes)
      : 20;
    const nowIso = new Date().toISOString();

    const { error: updErr } = await supabase
      .from('tickets')
      .update({
        status: 'serving',
        serving_started_at: nowIso,
        called_at: nowIso, // keep audit trail consistent — we logically "called" them when accepting
      })
      .eq('id', ticketId)
      .eq('status', 'pending_approval'); // optimistic lock — refuse if status changed
    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    // Lifecycle event — surfaces in operator activity feed and audit log.
    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: 'order_accepted',
      to_status: 'serving',
      metadata: { eta_minutes: etaMinutes, source: 'station_accept' },
    }).then(() => {}, () => {});

    // Customer WA — locale-aware.
    if (phone) {
      const msg =
        locale === 'ar'
          ? `✅ تم قبول طلبك #${ticket.ticket_number} في ${office?.name ?? ''}.\nالوقت المتوقع: ~${etaMinutes} دقيقة.\nالتتبع: ${trackUrl}`
          : locale === 'en'
            ? `✅ Order #${ticket.ticket_number} accepted at ${office?.name ?? ''}.\nReady in ~${etaMinutes} min.\nTrack: ${trackUrl}`
            : `✅ Commande n°${ticket.ticket_number} acceptée chez ${office?.name ?? ''}.\nPrête dans ~${etaMinutes} min.\nSuivi : ${trackUrl}`;
      const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
      void enqueueWaJob({
        ticketId,
        action: 'order_accepted',
        toPhone: phone,
        body: msg,
        payload: { eta_minutes: etaMinutes },
      }).catch((e) => console.warn('[orders/transition] enqueue accept failed', e?.message));
    }

    return NextResponse.json({ ok: true, action: 'accept', status: 'serving', eta_minutes: etaMinutes });
  }

  // ── Decline ────────────────────────────────────────────────────
  const reasonKey = body.declineReason ?? 'other';
  const reasonSpec = ORDER_DECLINE_REASONS.find((r) => r.key === reasonKey);
  if (!reasonSpec) {
    return NextResponse.json({ ok: false, error: 'Unknown decline reason' }, { status: 400 });
  }
  if (reasonSpec.requires_note && !body.declineNote?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'A note is required for this decline reason' },
      { status: 400 },
    );
  }
  const customerMessage = resolveLocalized(reasonSpec.customer_message, locale);
  const operatorNote = body.declineNote?.trim() || resolveLocalized(reasonSpec.label, locale);

  const { error: updErr } = await supabase
    .from('tickets')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      notes: operatorNote,
    })
    .eq('id', ticketId)
    .eq('status', 'pending_approval');
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'order_declined',
    to_status: 'cancelled',
    metadata: { decline_reason: reasonKey, decline_note: body.declineNote ?? null, source: 'station_decline' },
  }).then(() => {}, () => {});

  if (phone) {
    const customNote = body.declineNote?.trim();
    const baseMsg =
      locale === 'ar'
        ? `❌ نأسف، لم نتمكن من قبول طلبك #${ticket.ticket_number} في ${office?.name ?? ''}.\n${customerMessage}`
        : locale === 'en'
          ? `❌ Sorry — order #${ticket.ticket_number} at ${office?.name ?? ''} couldn't be accepted.\n${customerMessage}`
          : `❌ Désolé — la commande n°${ticket.ticket_number} chez ${office?.name ?? ''} n'a pas pu être acceptée.\n${customerMessage}`;
    const fullMsg = customNote ? `${baseMsg}\n\n"${customNote}"` : baseMsg;
    const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
    void enqueueWaJob({
      ticketId,
      action: 'order_declined',
      toPhone: phone,
      body: fullMsg,
      payload: { reason: reasonKey, note: body.declineNote ?? null },
    }).catch((e) => console.warn('[orders/transition] enqueue decline failed', e?.message));
  }

  return NextResponse.json({ ok: true, action: 'decline', status: 'cancelled', reason: reasonKey });
}
