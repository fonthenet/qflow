import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { transitionAppointment } from '@/lib/lifecycle';
import { checkInAppointment } from '@/lib/actions/appointment-actions';
import { checkRateLimit, generalLimiter } from '@/lib/rate-limit';
import { safeCompare } from '@/lib/crypto-utils';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/moderate-appointment
 * Body: { appointmentId: string, action: 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'complete', reason?: string }
 *
 * Authentication: Bearer token (Supabase JWT for staff, or service role key / INTERNAL_WEBHOOK_SECRET).
 *
 * All status transitions and side-effects (ticket sync, customer notification,
 * waitlist notification) are handled by the centralized lifecycle module.
 * check_in and complete have special handling (ticket creation / ticket served).
 */
type ModerateAction = 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'complete';

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

  const isAuthenticated = await authenticateRequest(request);
  if (!isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { appointmentId?: string; action?: ModerateAction; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { appointmentId, action, reason } = body;
  const validActions: ModerateAction[] = ['approve', 'decline', 'cancel', 'no_show', 'check_in', 'complete'];
  if (!appointmentId || !action || !validActions.includes(action)) {
    return NextResponse.json(
      { error: 'appointmentId and action (approve|decline|cancel|no_show|check_in|complete) are required' },
      { status: 400 },
    );
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
  if (action === 'complete') {
    const sb = createAdminClient();
    // Update appointment
    const { error: updErr } = await (sb as any)
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', appointmentId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 409 });
    }
    // Mark linked ticket(s) as served
    const nowIso = new Date().toISOString();
    await (sb as any)
      .from('tickets')
      .update({ status: 'served', completed_at: nowIso })
      .eq('appointment_id', appointmentId)
      .in('status', ['waiting', 'called', 'serving']);
    return NextResponse.json({
      ok: true,
      status: 'completed',
      notified: false,
      channel: null,
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
