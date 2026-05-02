import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rider/details
 *
 * Returns the customer-card / drop-off / status fields the native
 * rider screen needs to render. Same token-based auth as
 * /api/rider/heartbeat — no session login required.
 *
 * Body: { ticketId, token }
 *
 * Response shape mirrors the web rider portal page's server-rendered
 * props so the native screen can drop straight in. Static fields
 * (no realtime subscription) — the screen polls or relies on push
 * for live updates.
 *
 * v2 additions:
 *   - picked_up_at
 *   - pickup: { name, address, lat, lng, phone } from offices join
 *   - items: [{ id, name, qty, price, note }] from ticket_items
 *   - order_total: sum of price * qty
 */
export async function POST(request: NextRequest) {
  let body: { ticketId?: string; token?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const { ticketId, token } = body;
  if (!ticketId || !token) {
    return NextResponse.json({ ok: false, error: 'ticketId and token required' }, { status: 400 });
  }
  if (!verifyRiderToken(ticketId, token)) {
    return NextResponse.json({ ok: false, error: 'Invalid rider token' }, { status: 401 });
  }

  const supabase = createAdminClient() as any;

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(`
      id, ticket_number, status, customer_data, delivery_address,
      notes, arrived_at, delivered_at, dispatched_at, picked_up_at,
      assigned_rider_id, office_id,
      offices ( name, address, latitude, longitude, organization_id, organizations ( name, settings ) )
    `)
    .eq('id', ticketId)
    .maybeSingle();

  if (error || !ticket) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }

  // Fetch order items for this ticket.
  const { data: rawItems } = await supabase
    .from('ticket_items')
    .select('id, name, qty, price, note')
    .eq('ticket_id', ticketId)
    .order('added_at', { ascending: true });

  const items: { id: string; name: string; qty: number; price: number; note: string | null }[] =
    (rawItems ?? []).map((i: any) => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      price: i.price,
      note: i.note ?? null,
    }));

  const order_total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  // Flatten the org name out of the nested join so the native client
  // doesn't have to traverse two levels of joins.
  const orgName = (ticket.offices as any)?.organizations?.name
    ?? (ticket.offices as any)?.name
    ?? null;

  // Office row has no phone column — fall back to the org's
  // settings.business_phone (or whatsapp_business_phone). Riders
  // need a callable number for the restaurant; the org-level
  // contact is the canonical source.
  const officeRaw = ticket.offices as any;
  const orgSettings = officeRaw?.organizations?.settings ?? {};
  const pickupPhone = (orgSettings?.business_phone || orgSettings?.whatsapp_business_phone || null) as string | null;
  const pickup = officeRaw ? {
    name: officeRaw.name ?? null,
    address: officeRaw.address ?? null,
    lat: officeRaw.latitude ?? null,
    lng: officeRaw.longitude ?? null,
    phone: pickupPhone,
  } : null;

  return NextResponse.json({
    ok: true,
    ticket: {
      id: ticket.id,
      ticket_number: ticket.ticket_number,
      status: ticket.status ?? null,
      customer_data: ticket.customer_data ?? null,
      delivery_address: ticket.delivery_address ?? null,
      notes: ticket.notes ?? null,
      arrived_at: ticket.arrived_at ?? null,
      delivered_at: ticket.delivered_at ?? null,
      dispatched_at: ticket.dispatched_at ?? null,
      picked_up_at: ticket.picked_up_at ?? null,
      assigned_rider_id: ticket.assigned_rider_id ?? null,
      organization_name: orgName,
      pickup,
      items,
      order_total,
    },
  });
}
