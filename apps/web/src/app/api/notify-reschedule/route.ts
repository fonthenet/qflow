import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyAppointmentRescheduled } from '@/lib/lifecycle';
import { safeCompare } from '@/lib/crypto-utils';

/**
 * POST /api/notify-reschedule
 * Body: { appointmentId: string, newScheduledAt: string }
 *
 * Called by the Desktop Station after rescheduling an appointment via
 * direct Supabase update. Sends WhatsApp/Messenger notification to the customer.
 */
export async function POST(request: NextRequest) {
  // Authenticate — accept Supabase JWT, service-role key, or webhook secret
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearerToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  let authed = false;
  if (serviceKey && safeCompare(bearerToken, serviceKey)) authed = true;
  if (!authed && webhookSecret && safeCompare(bearerToken, webhookSecret)) authed = true;

  if (!authed) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
      if (!error && user) authed = true;
    } catch {}
  }

  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { appointmentId?: string; newScheduledAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { appointmentId, newScheduledAt } = body;
  if (!appointmentId || !newScheduledAt) {
    return NextResponse.json({ error: 'appointmentId and newScheduledAt required' }, { status: 400 });
  }

  const result = await notifyAppointmentRescheduled(appointmentId, newScheduledAt);
  return NextResponse.json(result);
}
