import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendRiderOtp } from '@/lib/rider-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/auth/start
 *   body: { phone }
 *
 * Looks up the rider by phone (active only). If found, generates a
 * 6-digit code and sends via WhatsApp. We DO NOT reveal whether the
 * phone is registered — the response shape is identical for both
 * "found and sent" and "not found". This avoids enumerating which
 * numbers belong to riders.
 */
export async function POST(request: NextRequest) {
  let body: { phone?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const phone = (body.phone ?? '').trim();
  if (!phone || !/^\+?\d{6,20}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: 'Valid phone required' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;
  const { data: rider } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('phone', phone)
    .eq('is_active', true)
    .maybeSingle();

  if (!rider) {
    // Quiet success — don't leak which numbers exist. Add a small
    // delay to roughly match the OTP-generation path so timing
    // doesn't reveal it either.
    await new Promise((r) => setTimeout(r, 200));
    return NextResponse.json({ ok: true });
  }

  const r = await sendRiderOtp({
    phone,
    purpose: 'login',
    riderId: rider.id,
    riderName: rider.name,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error ?? 'Failed to send code' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
