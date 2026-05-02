import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';
import { sendRiderOtp } from '@/lib/rider-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/auth/change-phone
 *   body: { newPhone }
 *
 * Step 1 of the change-phone flow. Authenticated rider asks to move
 * their account to a new WA number. We send an OTP to the NEW phone
 * (not the old one) — the rider has to prove they own the new device.
 *
 * Guard against collisions: if the new phone already belongs to
 * another active rider in the same org, we 409. (A given phone may
 * still belong to a rider in a DIFFERENT org — that's allowed by the
 * uq_active_org_phone uniqueness constraint.)
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { newPhone?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const rawNewPhone = (body.newPhone ?? '').trim();
  if (!rawNewPhone || !/^\+?\d{6,20}$/.test(rawNewPhone)) {
    return NextResponse.json({ ok: false, error: 'Valid phone required' }, { status: 400 });
  }
  // Normalise to the no-leading-+ form the riders table uses.
  const newPhone = rawNewPhone.replace(/^\++/, '').replace(/^00/, '').replace(/\D/g, '');
  if (newPhone === session.riderPhone) {
    return NextResponse.json({ ok: false, error: 'New phone must differ from current.' }, { status: 400 });
  }

  // Reject if the target phone is already used by another active
  // rider in the same org. Different orgs can share phones.
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

  // Bind the OTP to this rider so verify can't be tricked into
  // updating someone else's account if their phone happened to match.
  const r = await sendRiderOtp({
    phone: newPhone,
    purpose: 'change_phone',
    riderId: session.riderId,
    riderName: session.riderName,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error ?? 'Failed to send code' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
