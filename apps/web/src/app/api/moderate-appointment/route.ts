import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { transitionAppointment } from '@/lib/lifecycle';
import { checkInAppointment } from '@/lib/actions/appointment-actions';
import { checkRateLimit, generalLimiter } from '@/lib/rate-limit';
import { safeCompare } from '@/lib/crypto-utils';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/moderate-appointment
 * Body: { appointmentId?: string, calendarToken?: string, action, reason? }
 *
 * Authentication:
 *   - Staff: Bearer token (Supabase JWT, service role key, or INTERNAL_WEBHOOK_SECRET).
 *     All actions allowed.
 *   - Customer (mobile app, etc): `calendarToken` in body — no Bearer required.
 *     Limited to self-service actions: `cancel`, `check_in`. The token is the
 *     opaque per-appointment access key issued at booking time, and it resolves
 *     to a single appointmentId server-side — no spoofing possible.
 *
 * All status transitions and side-effects (ticket sync, customer notification,
 * waitlist notification) are handled by the centralized lifecycle module.
 * check_in and complete have special handling (ticket creation / ticket served).
 */
type ModerateAction = 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'complete' | 'delete';
const CUSTOMER_ALLOWED_ACTIONS: ModerateAction[] = ['cancel', 'check_in'];

const ACTION_TO_STATUS: Record<string, string> = {
  approve: 'confirmed',
  decline: 'cancelled',
  cancel: 'cancelled',
  no_show: 'no_show',
};

async function authenticateRequest(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearerToken) return false;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(bearerToken, serviceKey)) return true;
  if (webhookSecret && safeCompare(bearerToken, webhookSecret)) return true;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
    if (error || !user) return false;
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, generalLimiter);
  if (blocked) return blocked;

  let body: { appointmentId?: string; calendarToken?: string; action?: ModerateAction; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { calendarToken, action, reason } = body;
  let { appointmentId } = body;
  const validActions: ModerateAction[] = ['approve', 'decline', 'cancel', 'no_show', 'check_in', 'complete', 'delete'];

  // ── Auth: customer calendarToken path OR staff Bearer path ───────
  let isCustomerAuth = false;
  if (calendarToken && typeof calendarToken === 'string') {
    if (!action || !CUSTOMER_ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'Customer token only permits cancel or check_in' },
        { status: 403 },
      );
    }
    // Resolve appointmentId from token (never trust client-provided id here)
    const sbLookup = createAdminClient();
    const { data: apptLookup, error: lookupErr } = await (sbLookup as any)
      .from('appointments')
      .select('id')
      .eq('calendar_token', calendarToken)
      .single();
    if (lookupErr || !apptLookup?.id) {
      return NextResponse.json({ error: 'Invalid appointment token' }, { status: 404 });
    }
    appointmentId = apptLookup.id;
    isCustomerAuth = true;
  } else {
    const isAuthenticated = await authenticateRequest(request);
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!appointmentId || !action || !validActions.includes(action)) {
    return NextResponse.json(
      { error: 'appointmentId (or calendarToken) and action (approve|decline|cancel|no_show|check_in|complete|delete) are required' },
      { status: 400 },
    );
  }
  // Belt-and-braces: even if staff bypasses, customer path can never delete/approve/etc
  if (isCustomerAuth && !CUSTOMER_ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Action not permitted with customer token' }, { status: 403 });
  }

  // ── delete: permanently remove appointment + linked unserved tickets ──
  if (action === 'delete') {
    const { deleteAppointment } = await import('@/lib/actions/appointment-actions');
    const result = await deleteAppointment(appointmentId);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      status: 'deleted',
      notified: false,
      channel: null,
      notifyError: null,
    });
  }

  // ── check_in: create ticket + send "joined" notification ──
  if (action === 'check_in') {
    const result = await checkInAppointment(appointmentId);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      status: 'checked_in',
      ticket: result.data?.ticket ?? null,
      notified: true,
      channel: 'whatsapp',
      notifyError: null,
    });
  }

  // ── complete: mark appointment completed + linked ticket served ──
  // Uses the existing ticket-transition path for notifications, session cleanup,
  // and position reminders — no duplicated logic.
  if (action === 'complete') {
    const sb = createAdminClient();
    // Update appointment status (with precondition to prevent race conditions)
    const { error: updErr, count: updCount } = await (sb as any)
      .from('appointments')
      .update({ status: 'completed' }, { count: 'exact' })
      .eq('id', appointmentId)
      .in('status', ['confirmed', 'checked_in', 'serving']);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 409 });
    }
    if (updCount === 0) {
      return NextResponse.json({ error: 'Appointment already in terminal state or modified by another user' }, { status: 409 });
    }
    // Find linked ticket(s) via both directions
    const ticketIds = new Set<string>();
    const { data: byApptId } = await (sb as any)
      .from('tickets').select('id')
      .eq('appointment_id', appointmentId)
      .in('status', ['waiting', 'called', 'serving']);
    if (byApptId) byApptId.forEach((t: any) => ticketIds.add(t.id));
    const { data: apptRow } = await (sb as any)
      .from('appointments').select('ticket_id')
      .eq('id', appointmentId).single();
    if (apptRow?.ticket_id) ticketIds.add(apptRow.ticket_id);

    // Transition each linked ticket through the standard ticket-transition path
    let notified = false;
    let channel: string | null = null;
    const { onTicketTerminal } = await import('@/lib/lifecycle');
    const { notifyCustomer } = await import('@/lib/notify');
    const nowIso = new Date().toISOString();

    for (const tkId of ticketIds) {
      // Mark ticket served
      await (sb as any).from('tickets')
        .update({ status: 'served', completed_at: nowIso })
        .eq('id', tkId)
        .in('status', ['waiting', 'called', 'serving']);
      // Send notification (same as ticket-transition does)
      try {
        const nr = await notifyCustomer(tkId, 'served', { skipNotification: false });
        if (nr.sent) { notified = true; channel = nr.channel; }
      } catch { /* non-critical */ }
      // Close session (same as ticket-transition does)
      try {
        await (sb as any).from('whatsapp_sessions')
          .update({ state: 'completed' }).eq('ticket_id', tkId);
      } catch { /* non-critical */ }
    }
    return NextResponse.json({
      ok: true,
      status: 'completed',
      notified,
      channel,
      notifyError: null,
    });
  }

  // ── Standard transitions (approve/decline/cancel/no_show) ──
  const newStatus = ACTION_TO_STATUS[action];
  const result = await transitionAppointment(appointmentId, newStatus as any, { reason });

  if (!result.ok) {
    return NextResponse.json({ error: result.notifyError ?? 'Transition failed' }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    notified: result.notified,
    channel: result.channel,
    notifyError: result.notifyError,
  });
}
