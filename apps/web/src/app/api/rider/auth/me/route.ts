import { NextRequest, NextResponse } from 'next/server';
import { verifyRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/rider/auth/me
 *
 * Returns the current rider for a Bearer token. The Expo auth context
 * calls this on cold start to confirm the cached token is still valid
 * (covers operator force-revocation, rider-deactivated, etc.).
 */
export async function GET(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    rider: {
      id: session.riderId,
      name: session.riderName,
      phone: session.riderPhone,
      organization_id: session.organizationId,
    },
  });
}
