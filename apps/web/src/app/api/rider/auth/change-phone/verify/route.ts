import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';
import { verifyRiderOtp } from '@/lib/rider-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/auth/change-phone/verify
 *   body: { newPhone, code }
 *
 * Step 2: verify the OTP that was sent to the new phone, then move
 * the rider's phone column. The session itself stays valid — the
 * device that initiated the change keeps using its bearer token.
 *
 * We do NOT revoke other sessions on phone change. Rationale: a
 * rider who's logged in on two devices should keep both working
 * after a phone-number change. If they want to kick other devices,
 * a separate "Sign out everywhere" action handles that (future).
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { newPhone?: string; code?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const newPhone = (body.newPhone ?? '').trim();
  const code = (body.code ?? '').trim();
  if (!newPhone || !code) {
    return NextResponse.json({ ok: false, error: 'newPhone + code required' }, { status: 400 });
  }

  const v = await verifyRiderOtp({
    phone: newPhone,
    code,
    purpose: 'change_phone',
    expectedRiderId: session.riderId,
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error ?? 'Invalid code' }, { status: 401 });
  }

  // Re-check collision at commit time — someone may have grabbed the
  // number in the 10-min window between start and verify.
  const supabase = createAdminClient() as any;
  const { data: collision } = await supabase
    .from('riders')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('phone', newPhone)
    .eq('is_active', true)
    .neq('id', session.riderId)
    .maybeSingle();
  if (collision) {
    return NextResponse.json({ ok: false, error: 'That number is already in use.' }, { status: 409 });
  }

  const { error: updErr } = await supabase
    .from('riders')
    .update({ phone: newPhone })
    .eq('id', session.riderId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, phone: newPhone });
}
