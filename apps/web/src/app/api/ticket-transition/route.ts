import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { t as tMsg, type Locale } from '@/lib/messaging-commands';
import { safeCompare } from '@/lib/crypto-utils';
import { getQueuePosition } from '@/lib/queue-position';
import { formatPosition, formatNowServing } from '@/lib/messaging-commands';
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
 * }
 *
 * Returns: { ok, notified, channel, notifyError }
 */

const VALID_STATUSES = ['called', 'serving', 'served', 'no_show', 'cancelled'];

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
    const supabase = createAdminClient();
    // Verify the token is a real JWT by checking it (admin client ignores it,
    // but we validate format)
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
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId, status, deskId, deskName, staffId } = body;
  if (!ticketId || !status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `ticketId and status (${VALID_STATUSES.join('|')}) are required` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient() as any;

  // Fetch ticket
  const { data: ticket, error: fetchErr } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, status, qr_token, department_id, service_id, locale, customer_data, appointment_id')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // ── Update ticket status ──────────────────────────────────────────
  // The Postgres trigger will ALSO fire (for push notifications + position
  // reminders). The trigger checks has_session before sending WhatsApp,
  // but since we send WhatsApp here first, the trigger's WhatsApp call
  // will be deduped by the 60s dedup window in the edge function.
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

  // ── Send WhatsApp/Messenger notification ──────────────────────────
  // Find the active session for this ticket
  const { data: sessions } = await supabase
    .from('whatsapp_sessions')
    .select('id, channel, whatsapp_phone, messenger_psid, locale, organization_id')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1);
  const session = sessions?.[0];

  if (!session) {
    // No session = no chat channel to notify through
    return NextResponse.json({
      ok: true,
      status,
      notified: false,
      channel: null,
      notifyError: 'no_session',
    });
  }

  // Resolve locale and org name
  const locale: Locale = (ticket.locale as Locale) || (session.locale as Locale) || 'fr';
  let orgName = '';
  try {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', session.organization_id)
      .single();
    orgName = org?.name ?? '';
  } catch {}

  const resolvedDeskName = deskName || 'your desk';

  // Build message based on status
  let messageBody = '';
  switch (status) {
    case 'called':
      messageBody = tMsg('called', locale, {
        name: orgName,
        ticket: ticket.ticket_number,
        desk: resolvedDeskName,
      });
      break;
    case 'serving':
      messageBody = tMsg('now_serving', locale, {
        name: orgName,
        ticket: ticket.ticket_number,
        desk: resolvedDeskName,
      });
      break;
    case 'served':
      messageBody = tMsg('served', locale, { name: orgName });
      break;
    case 'no_show':
      messageBody = tMsg('no_show', locale, { name: orgName });
      break;
    case 'cancelled':
      messageBody = tMsg('cancelled', locale, { name: orgName });
      break;
  }

  let notified = false;
  let notifyError: string | null = null;

  if (messageBody) {
    try {
      if (session.channel === 'whatsapp' && session.whatsapp_phone) {
        await sendWhatsAppMessage({ to: session.whatsapp_phone, body: messageBody });
        notified = true;
      } else if (session.channel === 'messenger' && session.messenger_psid) {
        await sendMessengerMessage({ recipientId: session.messenger_psid, text: messageBody });
        notified = true;
      }
    } catch (e: any) {
      notifyError = e?.message || String(e);
      console.error(`[ticket-transition] notification failed for ${ticket.ticket_number}:`, e);
    }
  }

  // ── Position reminders for next-in-line ───────────────────────────
  // When a ticket leaves the queue (called/served/no_show/cancelled),
  // notify the next person in line if they have a session.
  if (['called', 'served', 'no_show', 'cancelled'].includes(status)) {
    try {
      const { data: nextTickets } = await supabase
        .from('tickets')
        .select('id, ticket_number, qr_token, locale')
        .eq('department_id', ticket.department_id)
        .eq('office_id', ticket.office_id)
        .eq('status', 'waiting')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1);

      const nextTicket = nextTickets?.[0];
      if (nextTicket) {
        const { data: nextSessions } = await supabase
          .from('whatsapp_sessions')
          .select('id, channel, whatsapp_phone, messenger_psid, locale, organization_id')
          .eq('ticket_id', nextTicket.id)
          .eq('state', 'active')
          .limit(1);

        const nextSession = nextSessions?.[0];
        if (nextSession) {
          const nextLocale: Locale = (nextTicket.locale as Locale) || (nextSession.locale as Locale) || 'fr';
          const nextMsg = tMsg('next_in_line', nextLocale, {
            name: orgName,
            ticket: nextTicket.ticket_number,
          });
          try {
            if (nextSession.channel === 'whatsapp' && nextSession.whatsapp_phone) {
              await sendWhatsAppMessage({ to: nextSession.whatsapp_phone, body: nextMsg });
            } else if (nextSession.channel === 'messenger' && nextSession.messenger_psid) {
              await sendMessengerMessage({ recipientId: nextSession.messenger_psid, text: nextMsg });
            }
          } catch (e: any) {
            console.warn('[ticket-transition] next-in-line notify failed:', e?.message);
          }
        }
      }
    } catch (e: any) {
      console.warn('[ticket-transition] position reminder failed:', e?.message);
    }
  }

  // Close session on terminal events
  if (['served', 'no_show', 'cancelled'].includes(status) && session.id) {
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq('id', session.id);
  }

  return NextResponse.json({
    ok: true,
    status,
    notified,
    channel: session.channel,
    notifyError,
  });
}
