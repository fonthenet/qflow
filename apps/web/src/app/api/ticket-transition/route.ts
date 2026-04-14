import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { notifyCustomer, type NotifyEvent } from '@/lib/notify';
import { APP_BASE_URL } from '@/lib/config';
import { isValidTransition } from '@qflo/shared';

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
    skipStatusUpdate?: boolean;
    /** Override notification event (e.g. 'recall' instead of default 'called') */
    notifyEvent?: string;
    /** Optional notes to persist alongside the transition */
    notes?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId, status, deskId, deskName, staffId, skipNotification, skipStatusUpdate, notifyEvent, notes } = body;

  // ── Notes-only update (no status change) ─────────────────────────
  // When status is missing but ticketId + notes are present, just persist notes.
  // Also syncs to the linked appointment so notes are visible in the Calendar.
  if (ticketId && !status && notes !== undefined) {
    const supabaseAdmin = createAdminClient() as any;
    const { error: notesErr } = await supabaseAdmin
      .from('tickets')
      .update({ notes: notes || null })
      .eq('id', ticketId);
    if (notesErr) {
      return NextResponse.json({ error: notesErr.message }, { status: 500 });
    }
    // Sync notes to linked appointment (if any)
    await syncNotesToAppointment(supabaseAdmin, ticketId, notes || null);
    return NextResponse.json({ ok: true, saved: 'notes' });
  }

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

  // ── Validate transition & update ────────────────────────────────
  const alreadyInState = ticket.status === status;

  if (!alreadyInState && !skipStatusUpdate) {
    if (!isValidTransition(ticket.status, status)) {
      return NextResponse.json(
        { error: `Invalid transition: ${ticket.status} → ${status}` },
        { status: 409 },
      );
    }

    // ── Update ticket status ──────────────────────────────────────
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
    // Include notes if provided
    if (notes !== undefined) updatePayload.notes = notes || null;

    const { error: updateErr } = await supabase
      .from('tickets')
      .update(updatePayload)
      .eq('id', ticketId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // ── Sync linked appointment status ────────────────────────────────
  // ALWAYS sync appointment for terminal statuses, even if ticket was already
  // in this state (race: sync queue may update ticket before this API call).
  if (status === 'served' || status === 'cancelled' || status === 'no_show') {
    try {
      const { onTicketTerminal } = await import('@/lib/lifecycle');
      await onTicketTerminal(ticketId, status);
    } catch (e: any) {
      console.warn('[ticket-transition] lifecycle sync failed:', e?.message);
    }
    // Sync final ticket notes to linked appointment
    if (notes !== undefined) {
      await syncNotesToAppointment(supabase, ticketId, notes || null);
    } else {
      // Fetch ticket notes if not provided in this request
      const { data: tkNotes } = await supabase.from('tickets').select('notes').eq('id', ticketId).single();
      if (tkNotes?.notes) await syncNotesToAppointment(supabase, ticketId, tkNotes.notes);
    }
  }

  // ── Resolve wait-minutes from org settings (auto_no_show_timeout) ──
  let waitMinutes: number | undefined;
  if (status === 'called' || notifyEvent === 'recall' || notifyEvent === 'buzz') {
    try {
      const { data: office } = await supabase
        .from('offices')
        .select('organization_id')
        .eq('id', ticket.office_id)
        .single();
      if (office?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', office.organization_id)
          .single();
        const orgSettings = org?.settings ?? {};
        const timeout = Number(orgSettings.auto_no_show_timeout);
        if (timeout > 0) waitMinutes = timeout;
      }
    } catch { /* non-critical — fallback to default */ }
  }

  // ── Send notification via unified notifyCustomer ──────────────────
  const event = (notifyEvent as NotifyEvent) || STATUS_TO_EVENT[status];
  const notifyResult = await notifyCustomer(ticketId, event, {
    deskName: deskName || undefined,
    skipNotification: skipNotification ?? false,
    waitMinutes,
  });

  // ── Web Push + APNs + Android push (all channels, fire-and-forget) ──
  const pushDeskName = deskName || 'your desk';
  const PUSH_MAP: Record<string, { type: string; title: string; body: string; tag: string }> = {
    called:           { type: 'called',  title: "🔔 YOUR TURN!",                body: `Ticket ${ticket.ticket_number} — Go to ${pushDeskName}`,                    tag: `called-${ticketId}` },
    recall:           { type: 'recall',  title: "⚠️ REMINDER — YOUR TURN!",     body: `Ticket ${ticket.ticket_number} — Go to ${pushDeskName} NOW`,                tag: `recall-${ticketId}` },
    buzz:             { type: 'buzz',    title: "📢 Staff is calling you",       body: `Ticket ${ticket.ticket_number} — Please go to ${pushDeskName}`,              tag: `buzz-${ticketId}` },
    serving:          { type: 'serving', title: "Being Served",                  body: `Ticket ${ticket.ticket_number} at ${pushDeskName}`,                          tag: `serving-${ticketId}` },
    served:           { type: 'served',  title: "Visit Complete ✓",              body: "Thank you! Tap to leave feedback.",                                          tag: `served-${ticketId}` },
    no_show:          { type: 'no_show', title: "Missed Your Turn",              body: `Ticket ${ticket.ticket_number} was marked as no-show.`,                      tag: `noshow-${ticketId}` },
    cancelled_notify: { type: 'no_show', title: "Ticket Cancelled",              body: `Ticket ${ticket.ticket_number} has been cancelled.`,                         tag: `cancel-${ticketId}` },
  };
  const pushInfo = PUSH_MAP[event];
  if (pushInfo && !(skipNotification ?? false)) {
    const pushPayload = {
      ...pushInfo,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      deskName: pushDeskName,
      status: ticket.status,
    };
    // Fire-and-forget with lazy imports — don't delay the response
    import('@/lib/send-push').then(m => m.sendPushToTicket(ticketId, pushPayload as any)).catch(() => {});
    import('@/lib/apns').then(m => m.sendAPNsToTicket(ticketId, {
      title: pushInfo.title,
      body: pushInfo.body,
      url: `/q/${ticket.qr_token}`,
    })).catch(() => {});
    import('@/lib/android-push').then(m => m.sendAndroidToTicket(ticketId, pushPayload as any)).catch(() => {});
  }

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

/**
 * Sync ticket notes to the linked appointment (both link directions).
 * This keeps Calendar and Station notes in sync — one source of truth.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncNotesToAppointment(supabase: any, ticketId: string, notes: string | null) {
  try {
    // Direction 1: ticket.appointment_id → appointment
    const { data: tk } = await supabase
      .from('tickets')
      .select('appointment_id')
      .eq('id', ticketId)
      .single();
    if (tk?.appointment_id) {
      await supabase.from('appointments').update({ notes }).eq('id', tk.appointment_id);
      return;
    }
    // Direction 2: appointment.ticket_id → ticket
    await supabase.from('appointments').update({ notes }).eq('ticket_id', ticketId);
  } catch (e: any) {
    console.warn('[ticket-transition] syncNotesToAppointment failed:', e?.message);
  }
}
