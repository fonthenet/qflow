import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession, revokeAllRiderSessions } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/leave
 *   Auth: Bearer rider session token.
 *   Body: (empty)
 *
 * Self-serve "stop being a driver" — flips `riders.is_active = false`
 * for the rider tied to the calling session, revokes every other
 * active session for that rider, and drops the device push tokens
 * so future assignments don't reach this device.
 *
 * The rider row stays in the table (`is_active=false`) so historical
 * deliveries still resolve their name on the operator's reporting
 * surfaces. Operator can re-activate them later by re-adding the
 * phone number from the Drivers admin tab.
 *
 * NOTE: this leaves a single org. A rider whose phone is registered
 * with multiple businesses calls this endpoint once per org session
 * to fully detach.
 */
export async function POST(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient() as any;

  // 1. Inactivate the rider row.
  const { error: updErr } = await supabase
    .from('riders')
    .update({ is_active: false })
    .eq('id', session.riderId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // 2. Revoke every active session for this rider (every device they
  //    were signed in on stops working immediately on next API call).
  await revokeAllRiderSessions(session.riderId);

  // 3. Drop the rider's device push tokens so the operator's next
  //    "Assign rider" attempt doesn't push to a phone that just left.
  await supabase.from('rider_devices').delete().eq('rider_id', session.riderId);

  // 4. Audit row so the operator can see what happened in their
  //    reporting / Station event log.
  await supabase.from('ticket_events').insert({
    ticket_id: null,
    event_type: 'rider_left_business',
    metadata: {
      rider_id: session.riderId,
      rider_phone: session.riderPhone,
      organization_id: session.organizationId,
      source: 'rider_self_serve',
    },
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true });
}
