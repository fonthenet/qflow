import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderOtp } from '@/lib/rider-otp';
import { mintRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/auth/verify
 *   body: { phone, code, deviceLabel? }
 *
 * Verifies the OTP and mints a long-lived bearer token for the device.
 * Returns the token + minimal rider profile. The token must be sent
 * as `Authorization: Bearer <token>` on every subsequent rider API call.
 */
export async function POST(request: NextRequest) {
  let body: { phone?: string; code?: string; deviceLabel?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const rawPhone = (body.phone ?? '').trim();
  const code = (body.code ?? '').trim();
  if (!rawPhone || !code) {
    return NextResponse.json({ ok: false, error: 'phone + code required' }, { status: 400 });
  }
  // Match the normalization in auth/start so the OTP row's `phone`
  // and the lookup here both use the no-leading-+ form.
  const phone = rawPhone.replace(/^\++/, '').replace(/^00/, '').replace(/\D/g, '');

  // Look up the rider so verify can bind to a real account. We do
  // this BEFORE verifying the code so an attacker probing OTPs
  // against unregistered phones gets a quick 401 either way.
  const supabase = createAdminClient() as any;
  const { data: rider } = await supabase
    .from('riders')
    .select('id, name, phone, avatar_url, organization_id, is_active')
    .eq('phone', phone)
    .eq('is_active', true)
    .maybeSingle();
  if (!rider) {
    return NextResponse.json({ ok: false, error: 'Invalid code' }, { status: 401 });
  }

  const v = await verifyRiderOtp({ phone, code, purpose: 'login' });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error ?? 'Invalid code' }, { status: 401 });
  }

  const minted = await mintRiderSession(rider.id, body.deviceLabel ?? null);
  if (!minted) {
    return NextResponse.json({ ok: false, error: 'Could not start session' }, { status: 500 });
  }

  // Bump rider.last_seen_at — same field the operator's "active 2 min
  // ago" chip reads. Logging in counts as "active."
  await supabase
    .from('riders')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', rider.id);

  return NextResponse.json({
    ok: true,
    token: minted.token,
    rider: {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      avatar_url: rider.avatar_url ?? null,
      organization_id: rider.organization_id,
    },
  });
}
