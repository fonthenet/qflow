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
 * Each entry includes a fresh per-ticket HMAC `rider_token` so the
 * mobile UI can deeplink straight into the existing per-ticket
 * screen (the same one that handles ARRIVED / DELIVERED + GPS).
 * No DB write needed — the token is HMAC-derived from the ticket id.
 *
 * v2 additions per ticket:
 *   - picked_up_at
 *   - pickup: { name, address, lat, lng, phone } (phone added to offices join)
 *   - items: [{ id, name, qty, price, note }] batched in one query
 *   - order_total: sum of price * qty
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
      id, ticket_number, status, dispatched_at, arrived_at, picked_up_at,
      delivery_address, customer_data, notes,
      created_at,
      offices ( name, address, latitude, longitude, organization_id, organizations ( settings ) )
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

  const ticketList = tickets ?? [];

  // Batch-fetch all ticket_items for the returned tickets in one query.
  // Group by ticket_id for O(1) lookup when building the response.
  const ticketIds: string[] = ticketList.map((t: any) => t.id);
  let itemsByTicket: Record<string, { id: string; name: string; qty: number; price: number; note: string | null }[]> = {};

  if (ticketIds.length > 0) {
    const { data: rawItems } = await supabase
      .from('ticket_items')
      .select('id, ticket_id, name, qty, price, note')
      .in('ticket_id', ticketIds)
      .order('added_at', { ascending: true });

    for (const row of (rawItems ?? [])) {
      if (!itemsByTicket[row.ticket_id]) itemsByTicket[row.ticket_id] = [];
      itemsByTicket[row.ticket_id].push({
        id: row.id,
        name: row.name,
        qty: row.qty,
        price: row.price,
        note: row.note ?? null,
      });
    }
  }

  const items = ticketList.map((t: any) => {
    const ticketItems = itemsByTicket[t.id] ?? [];
    const order_total = ticketItems.reduce((sum: number, i) => sum + i.price * i.qty, 0);
    return {
      id: t.id,
      ticket_number: t.ticket_number,
      status: t.status,
      dispatched_at: t.dispatched_at,
      arrived_at: t.arrived_at,
      picked_up_at: t.picked_up_at,
      delivery_address: t.delivery_address,
      customer_data: t.customer_data,
      notes: t.notes,
      pickup: t.offices ? {
        name: t.offices.name,
        address: t.offices.address,
        lat: t.offices.latitude,
        lng: t.offices.longitude,
        // offices has no phone column — fall back to the org's
        // business_phone (or whatsapp_business_phone) from settings
        // so riders have a callable number for the restaurant.
        phone: (t.offices.organizations?.settings?.business_phone
          || t.offices.organizations?.settings?.whatsapp_business_phone
          || null) as string | null,
      } : null,
      rider_token: generateRiderToken(t.id),
      items: ticketItems,
      order_total,
    };
  });

  return NextResponse.json({ ok: true, items });
}
