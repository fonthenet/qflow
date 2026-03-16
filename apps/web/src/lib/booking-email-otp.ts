import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const BOOKING_EMAIL_OTP_COOKIE = 'qf_booking_email_otp';

function getBookingOtpSecret() {
  const secret =
    process.env.BOOKING_OTP_COOKIE_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'queueflow-dev-booking-otp-secret';

  return new TextEncoder().encode(secret);
}

export async function setBookingEmailOtpCookie(input: {
  email: string;
  officeId: string;
  expiresInMinutes: number;
}) {
  const cookieStore = await cookies();
  const token = await new SignJWT({
    email: input.email.trim().toLowerCase(),
    officeId: input.officeId,
    purpose: 'booking_email_otp',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, input.expiresInMinutes)}m`)
    .sign(getBookingOtpSecret());

  cookieStore.set(BOOKING_EMAIL_OTP_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(60, input.expiresInMinutes * 60),
  });
}

export async function clearBookingEmailOtpCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(BOOKING_EMAIL_OTP_COOKIE);
}

export async function hasVerifiedBookingEmail(input: {
  email: string;
  officeId: string;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(BOOKING_EMAIL_OTP_COOKIE)?.value;

  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, getBookingOtpSecret());
    return (
      payload.purpose === 'booking_email_otp' &&
      payload.email === input.email.trim().toLowerCase() &&
      payload.officeId === input.officeId
    );
  } catch {
    return false;
  }
}
