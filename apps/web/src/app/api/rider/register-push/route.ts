import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/register-push
 *
 * The native rider screen calls this once on mount with the device's
 * APNs/FCM token. We stash it on the ticket so the assignment /
 * unassign / customer-cancel notifier can push the rider instantly,
 * even when the app is closed and the phone is locked. Same HMAC
 * token check the rest of the rider endpoints use — no Supabase auth.
 *
 * Body: { ticketId, token, deviceToken, platform: 'ios' | 'android' }
 *
 * The ticket-scoped storage is intentional: rider auth is still
 * token-based, not staff-login. When the delivery completes the
 * heartbeat endpoint clears these columns alongside dispatch state.
 */
export async function POST(request: NextRequest) {
  let body: {
    ticketId?: string;
    token?: string;
    deviceToken?: string;
    platform?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, token, deviceToken, platform } = body;
  if (!ticketId || !token || !deviceToken) {
    return NextResponse.json({ ok: false, error: 'ticketId, token, deviceToken required' }, { status: 400 });
  }
  if (!verifyRiderToken(ticketId, token)) {
    return NextResponse.json({ ok: false, error: 'Invalid rider token' }, { status: 401 });
  }
  const plat = platform === 'ios' || platform === 'android' ? platform : null;

  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from('tickets')
    .update({
      rider_push_token: deviceToken,
      rider_push_platform: plat,
    })
    .eq('id', ticketId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
