import 'server-only';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * Phone-OTP for rider login + change-phone. Code lives in
 * rider_otp_codes (see migration 20260501250000) — sha256-hashed,
 * 10-minute expiry, 5-attempt cap, single-use.
 *
 * Delivery is direct WhatsApp send (not the durable outbox) because:
 *   - The outbox keys on ticketId; OTP has no ticket.
 *   - OTPs MUST be live to be useful — no point retrying after 10 min.
 *   - If WA fails, the user just taps Resend.
 */

const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

function generateCode(): string {
  // 6 random digits, no leading-zero stripping. Uses crypto, not Math.random.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(CODE_LENGTH, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export type OtpPurpose = 'login' | 'change_phone';

interface SendOtpOptions {
  phone: string;
  purpose: OtpPurpose;
  riderId?: string | null;
  riderName?: string | null;
}

export async function sendRiderOtp(opts: SendOtpOptions): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient() as any;
  const phone = opts.phone.trim();

  // Cooldown — don't allow a fresh code more than once per minute.
  const cooldownThreshold = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
  const { data: recent } = await supabase
    .from('rider_otp_codes')
    .select('id, created_at')
    .eq('phone', phone)
    .eq('purpose', opts.purpose)
    .gt('created_at', cooldownThreshold)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) {
    return { ok: false, error: 'Wait a minute before requesting another code.' };
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { error: insErr } = await supabase
    .from('rider_otp_codes')
    .insert({
      phone,
      code_hash: codeHash,
      expires_at: expiresAt,
      purpose: opts.purpose,
      rider_id: opts.riderId ?? null,
    });
  if (insErr) {
    console.warn('[rider-otp] insert failed', insErr.message);
    return { ok: false, error: 'Could not generate code, try again.' };
  }

  // Direct WA send — bypass outbox per the comment at the top.
  const greeting = opts.riderName ? `Hi ${opts.riderName}, ` : '';
  const body = opts.purpose === 'change_phone'
    ? `${greeting}your Qflo phone-change code is *${code}*. Expires in 10 minutes.`
    : `${greeting}your Qflo rider sign-in code is *${code}*. Expires in 10 minutes. Don't share this code.`;

  const r = await sendWhatsAppMessage({ to: phone, body });
  if (!r.ok) {
    return { ok: false, error: 'Could not send WhatsApp message. Check the number and try again.' };
  }
  return { ok: true };
}

interface VerifyOtpOptions {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  /** When set, the OTP row's rider_id must match — locks the
   *  change-phone flow to the authenticated rider. */
  expectedRiderId?: string;
}

export async function verifyRiderOtp(opts: VerifyOtpOptions): Promise<{ ok: boolean; riderId?: string | null; error?: string }> {
  const supabase = createAdminClient() as any;
  const phone = opts.phone.trim();
  const code = opts.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Invalid code format.' };
  }

  // Newest unused row for this (phone, purpose).
  const { data: row } = await supabase
    .from('rider_otp_codes')
    .select('id, code_hash, expires_at, attempts, rider_id')
    .eq('phone', phone)
    .eq('purpose', opts.purpose)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) {
    return { ok: false, error: 'No active code. Request a new one.' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Code expired. Request a new one.' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Too many wrong attempts. Request a new code.' };
  }
  if (opts.expectedRiderId && row.rider_id !== opts.expectedRiderId) {
    return { ok: false, error: 'Code does not match this account.' };
  }

  const expectedHash = hashCode(code);
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(expectedHash));
  if (!ok) {
    await supabase
      .from('rider_otp_codes')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id);
    return { ok: false, error: 'Wrong code.' };
  }

  // Single-use — burn the row.
  await supabase
    .from('rider_otp_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);

  return { ok: true, riderId: row.rider_id };
}
