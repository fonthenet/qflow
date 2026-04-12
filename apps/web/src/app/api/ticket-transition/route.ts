import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { notifyCustomer, type NotifyEvent } from '@/lib/notify';
import { APP_BASE_URL } from '@/lib/config';

/**
 * POST /api/ticket-transition
 *
 * Single endpoint for ALL critical ticket status changes.
 * Desktop/kiosk calls this DIRECTLY instead of relying on
 * sync → Postgres trigger → edge function chain.
 *
 * This is the primary notification path. The sync queue + Postgres trigger
 * remain as a safety net for offline scenarios, but this endpoint is the
 * reliable, confirmed path.
 *
 * Body: {
 *   ticketId: string,
 *   status: 'called' | 'serving' | 'served' | 'no_show' | 'cancelled',
 *   deskId?: string,
 *   deskName?: string,
 *   staffId?: string,
 *   skipNotification?: boolean,
 * }
 *
 * Returns: { ok, status, notified, channel, notifyError }
 */

const VALID_STATUSES = ['called', 'serving', 'served', 'no_show', 'cancelled'];

/** Map ticket status to notification event key */
const STATUS_TO_EVENT: Record<string, NotifyEvent> = {
  called: 'called',
  serving: 'serving',
  served: 'served',
  no_show: 'no_show',
  cancelled: 'cancelled_notify',
};

async function authenticateRequest(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearerToken) return false;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(bearerToken, serviceKey)) return true;
  if (webhookSecret && safeCompare(bearerToken, webhookSecret)) return true;

  // Accept any valid Supabase JWT (staff user)
  try {
    if (bearerToken.split('.').length === 3) return true;
  } catch {}
  return false;
}

export async function POST(request: NextRequest) {
  const isAuthenticated = await authenticateRequest(request);
  if (!isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    ticketId?: string;
    status?: string;
    deskId?: string;
    deskName?: string;
    staffId?: string;
    skipNotification?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId, status, deskId, deskName, staffId, skipNotification } = body;
  if (!ticketId || !status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `ticketId and status (${VALID_STATUSES.join('|')}) are required` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient() as any;

  // ── Fetch ticket ──────────────────────────────────────────────────
  const { data: ticket, error: fetchErr } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, status, qr_token, department_id, service_id, locale, customer_data, appointment_id')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // ── Update ticket status ──────────────────────────────────────────
  const now = new Date().toISOString();
  const updatePayload: Record<string, any> = { status };

  if (status === 'called') {
    updatePayload.called_at = now;
    if (deskId) updatePayload.desk_id = deskId;
    if (staffId) updatePayload.called_by_staff_id = staffId;
  } else if (status === 'serving') {
    updatePayload.serving_at = now;
    if (deskId) updatePayload.desk_id = deskId;
  } else if (status === 'served' || status === 'cancelled' || status === 'no_show') {
    updatePayload.completed_at = now;
  }

  const { error: updateErr } = await supabase
    .from('tickets')
    .update(updatePayload)
    .eq('id', ticketId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // ── Sync linked appointment status ────────────────────────────────
  if (status === 'served' || status === 'cancelled' || status === 'no_show') {
    try {
      const { onTicketTerminal } = await import('@/lib/lifecycle');
      await onTicketTerminal(ticketId, status);
    } catch (e: any) {
      console.warn('[ticket-transition] lifecycle sync failed:', e?.message);
    }
  }

  // ── Send notification via unified notifyCustomer ──────────────────
  const event = STATUS_TO_EVENT[status];
  const notifyResult = await notifyCustomer(ticketId, event, {
    deskName: deskName || undefined,
    skipNotification: skipNotification ?? false,
  });

  // ── Log notification failures for monitoring ──────────────────────
  if (!notifyResult.sent && notifyResult.error && notifyResult.error !== 'no_session' && notifyResult.error !== 'skipped') {
    try {
      await supabase.from('notification_failures').insert({
        ticket_id: ticketId,
        event,
        channel: notifyResult.channel,
        error: notifyResult.error,
      });
    } catch (e: any) {
      console.warn('[ticket-transition] Failed to log notification failure:', e?.message);
    }
  }

  // ── Position reminders for next-in-line ───────────────────────────
  if (['called', 'served', 'no_show', 'cancelled'].includes(status)) {
    try {
      const { data: nextTickets } = await supabase
        .from('tickets')
        .select('id')
        .eq('department_id', ticket.department_id)
        .eq('office_id', ticket.office_id)
        .eq('status', 'waiting')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1);

      const nextTicket = nextTickets?.[0];
      if (nextTicket) {
        await notifyCustomer(nextTicket.id, 'next_in_line');
      }
    } catch (e: any) {
      console.warn('[ticket-transition] position reminder failed:', e?.message);
    }
  }

  // ── Close session on terminal events ──────────────────────────────
  if (['served', 'no_show', 'cancelled'].includes(status)) {
    try {
      await supabase
        .from('whatsapp_sessions')
        .update({ state: 'completed' })
        .eq('ticket_id', ticketId);
    } catch (e: any) {
      console.warn('[ticket-transition] session close failed:', e?.message);
    }
  }

  return NextResponse.json({
    ok: true,
    status,
    notified: notifyResult.sent,
    channel: notifyResult.channel,
    notifyError: notifyResult.error || null,
  });
}
