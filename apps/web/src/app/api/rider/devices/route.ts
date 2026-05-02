import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/devices
 *   Auth: Bearer rider session token
 *   Body: { deviceToken: string, platform: 'ios' | 'android', deviceLabel?: string }
 *
 * Registers (or refreshes) a device under the calling rider. Same
 * token re-posted bumps last_seen_at via ON CONFLICT — single row
 * per (rider_id, device_token).
 *
 * Called by the Expo app after rider login + on every app launch.
 * Lets /api/orders/assign push to every device the rider owns when
 * a new ticket lands.
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { deviceToken?: string; platform?: string; deviceLabel?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const deviceToken = (body.deviceToken ?? '').trim();
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
  if (!deviceToken || !platform) {
    return NextResponse.json({ ok: false, error: 'deviceToken + platform required' }, { status: 400 });
  }
  const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim().slice(0, 80) || null : null;

  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from('rider_devices')
    .upsert(
      {
        rider_id: session.riderId,
        device_token: deviceToken,
        platform,
        device_label: deviceLabel,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'rider_id,device_token' },
    );
  if (error) {
    console.warn('[rider/devices] upsert failed', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/rider/devices
 *   Auth: Bearer rider session token
 *   Body: { deviceToken: string }
 *
 * Drops the calling rider's registration for this device. Called on
 * sign-out so a shared device doesn't keep getting pushes for the
 * previous rider.
 */
export async function DELETE(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { deviceToken?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const deviceToken = (body.deviceToken ?? '').trim();
  if (!deviceToken) {
    return NextResponse.json({ ok: false, error: 'deviceToken required' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;
  await supabase
    .from('rider_devices')
    .delete()
    .eq('rider_id', session.riderId)
    .eq('device_token', deviceToken);

  return NextResponse.json({ ok: true });
}
