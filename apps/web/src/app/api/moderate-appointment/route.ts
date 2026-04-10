import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { transitionAppointment } from '@/lib/lifecycle';
import { checkRateLimit, generalLimiter } from '@/lib/rate-limit';
import { safeCompare } from '@/lib/crypto-utils';

/**
 * POST /api/moderate-appointment
 * Body: { appointmentId: string, action: 'approve' | 'decline' | 'cancel' | 'no_show', reason?: string }
 *
 * Authentication: Bearer token (Supabase JWT for staff, or service role key / INTERNAL_WEBHOOK_SECRET).
 *
 * All status transitions and side-effects (ticket sync, customer notification,
 * waitlist notification) are handled by the centralized lifecycle module.
 */
type ModerateAction = 'approve' | 'decline' | 'cancel' | 'no_show';

const ACTION_TO_STATUS: Record<ModerateAction, string> = {
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
  const validActions: ModerateAction[] = ['approve', 'decline', 'cancel', 'no_show'];
  if (!appointmentId || !action || !validActions.includes(action)) {
    return NextResponse.json(
      { error: 'appointmentId and action (approve|decline|cancel|no_show) are required' },
      { status: 400 },
    );
  }

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
