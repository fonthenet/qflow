import { NextRequest, NextResponse } from 'next/server';
import { verifyRiderSession, revokeRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/auth/signout
 *
 * Revokes the current Bearer session. Idempotent — already-revoked or
 * unknown tokens still 200 (no point exposing whether the token was
 * valid to a caller signing out).
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (session) {
    await revokeRiderSession(session.sessionId);
  }
  return NextResponse.json({ ok: true });
}
