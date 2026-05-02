import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';
import { generateRiderToken } from '@/lib/rider-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/rider/active
 *
 * Returns every order currently assigned to the calling rider that
 * hasn't been delivered yet. Mirrors the operator's "in-flight"
 * concept used in /api/orders/assign so a batched run shows up
 * here too. Sorted by dispatched_at (accepted runs first), then by
 * assignment recency.
 *
 * Each entry includes a fresh per-ticket HMAC `riderToken` so the
 * mobile UI can deeplink straight into the existing per-ticket
 * screen (the same one that handles ARRIVED / DELIVERED + GPS).
 * No DB write needed — the token is HMAC-derived from the ticket id.
 */
export async function GET(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient() as any;
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select(`
      id, ticket_number, status, dispatched_at, arrived_at,
      delivery_address, customer_data, notes,
      created_at,
      offices ( name, address, latitude, longitude )
    `)
    .eq('assigned_rider_id', session.riderId)
    .is('delivered_at', null)
    .in('status', ['serving'])
    // Sort: accepted runs first (dispatched_at not null, oldest dispatch
    // first), then awaiting-accept by recency. tickets has no updated_at
    // — fall back to created_at as the recency tiebreaker.
    .order('dispatched_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const items = (tickets ?? []).map((t: any) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    status: t.status,
    dispatched_at: t.dispatched_at,
    arrived_at: t.arrived_at,
    delivery_address: t.delivery_address,
    customer_data: t.customer_data,
    notes: t.notes,
    pickup: t.offices ? {
      name: t.offices.name,
      address: t.offices.address,
      lat: t.offices.latitude,
      lng: t.offices.longitude,
    } : null,
    rider_token: generateRiderToken(t.id),
  }));

  return NextResponse.json({ ok: true, items });
}
