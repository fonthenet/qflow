/**
 * GET /api/kitchen/tickets?screenToken=<token>
 *
 * Returns active KDS cards: tickets in status ('called', 'serving') for the
 * resolved office, with their non-served ticket_items. Used by the web KDS
 * client component's reload() polling path.
 *
 * Auth: screen token is the sole credential (same pattern as /display).
 * Admin client is used server-side — this is a trusted, token-gated endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveKitchenScreenToken } from '@/lib/kitchen/resolve-screen-token';
import type { KitchenTicket } from '@/components/kitchen/kitchen-display-board';

export async function GET(req: NextRequest) {
  const screenToken = req.nextUrl.searchParams.get('screenToken');
  if (!screenToken) {
    return NextResponse.json({ error: 'screenToken required' }, { status: 400 });
  }

  const resolved = await resolveKitchenScreenToken(screenToken);
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid screen token' }, { status: 404 });
  }

  const { officeId, organizationId } = resolved;
  const supabase = createAdminClient();

  const { data: activeTickets } = await supabase
    .from('tickets')
    .select(
      'id, ticket_number, status, customer_data, called_at, service_id, restaurant_tables!current_ticket_id(label)',
    )
    .eq('office_id', officeId)
    .in('status', ['called', 'serving'])
    .order('called_at', { ascending: true });

  const ticketIds = (activeTickets ?? []).map((t: any) => t.id);

  // Resolve service names for the service-type pill.
  const serviceIds = [...new Set(
    (activeTickets ?? []).map((t: any) => t.service_id).filter(Boolean),
  )];
  const serviceNameById = new Map<string, string>();
  if (serviceIds.length > 0) {
    const { data: svcs } = await supabase
      .from('services')
      .select('id, name')
      .in('id', serviceIds);
    for (const svc of svcs ?? []) {
      if (svc.id && svc.name) serviceNameById.set(svc.id, svc.name);
    }
  }

  let itemsByTicket: Record<string, any[]> = {};
  if (ticketIds.length > 0) {
    const { data: items } = await supabase
      .from('ticket_items')
      .select(
        'id, ticket_id, organization_id, name, qty, note, added_at, kitchen_status, kitchen_status_at',
      )
      .in('ticket_id', ticketIds)
      .neq('kitchen_status', 'served')
      .order('added_at', { ascending: true });

    for (const item of items ?? []) {
      if (!itemsByTicket[item.ticket_id]) itemsByTicket[item.ticket_id] = [];
      itemsByTicket[item.ticket_id].push(item);
    }
  }

  const cards: KitchenTicket[] = (activeTickets ?? [])
    .map((t: any) => {
      const items = itemsByTicket[t.id] ?? [];
      if (items.length === 0) return null;
      const customerData = (t.customer_data as Record<string, unknown>) ?? {};
      const tableLabel = Array.isArray(t.restaurant_tables)
        ? t.restaurant_tables[0]?.label ?? null
        : (t.restaurant_tables as any)?.label ?? null;
      return {
        ticket_id: t.id,
        ticket_number: t.ticket_number,
        table_label: tableLabel,
        party_size: (customerData?.party_size as string | number | null) ?? null,
        customer_name: (customerData?.name ?? customerData?.customer_name ?? null) as string | null,
        ticket_status: t.status,
        oldest_item_at: items[0]?.added_at ?? t.called_at ?? new Date().toISOString(),
        service_name: t.service_id ? (serviceNameById.get(t.service_id) ?? null) : null,
        items: items.map((it: any) => ({
          id: it.id,
          ticket_id: it.ticket_id,
          organization_id: it.organization_id,
          name: it.name,
          qty: it.qty,
          note: it.note ?? null,
          added_at: it.added_at,
          kitchen_status: (it.kitchen_status ?? 'new') as 'new' | 'in_progress' | 'ready' | 'served',
          kitchen_status_at: it.kitchen_status_at ?? null,
        })),
      } satisfies KitchenTicket;
    })
    .filter(Boolean) as KitchenTicket[];

  return NextResponse.json(cards, {
    headers: {
      // Prevent CDN caching — KDS data must always be fresh
      'Cache-Control': 'no-store',
    },
  });
}
