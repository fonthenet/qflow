/**
 * POST /api/kitchen/update-item-status
 *
 * Body: { screenToken: string, itemId: string, status: 'new'|'in_progress'|'ready'|'served' }
 *
 * Validates token → office, then verifies the item belongs to a ticket in
 * that office before writing. Idempotent: no-op if kitchen_status already
 * matches the requested value (Meta-style duplicate delivery is safe).
 *
 * When the last non-served item on a ticket flips to 'ready', inserts a
 * notifications row (type='kitchen_ready') so Station + Expo operator
 * devices receive an instant in-app alert. Payload mirrors data-adapter.ts
 * bumpTicketKitchen() in apps/expo so the receiver-side renderer works
 * without changes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveKitchenScreenToken } from '@/lib/kitchen/resolve-screen-token';

const VALID_STATUSES = new Set(['new', 'in_progress', 'ready', 'served']);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { screenToken, itemId, status } = body as Record<string, unknown>;

  if (typeof screenToken !== 'string' || !screenToken) {
    return NextResponse.json({ error: 'screenToken required' }, { status: 400 });
  }
  if (typeof itemId !== 'string' || !itemId) {
    return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  }
  if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
      { status: 400 },
    );
  }

  const resolved = await resolveKitchenScreenToken(screenToken);
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid screen token' }, { status: 404 });
  }

  const { officeId } = resolved;
  const supabase = createAdminClient();

  // Fetch the item and its parent ticket to verify office ownership.
  const { data: item, error: itemErr } = await supabase
    .from('ticket_items')
    .select('id, kitchen_status, ticket_id, organization_id')
    .eq('id', itemId)
    .maybeSingle();

  if (itemErr || !item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // Verify the ticket belongs to the resolved office.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, customer_data, restaurant_tables!current_ticket_id(label)')
    .eq('id', item.ticket_id)
    .maybeSingle();

  if (!ticket || ticket.office_id !== officeId) {
    return NextResponse.json({ error: 'Item does not belong to this office' }, { status: 403 });
  }

  // Idempotency check — no-op if status already matches.
  if (item.kitchen_status === status) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('ticket_items')
    .update({ kitchen_status: status, kitchen_status_at: now } as any)
    .eq('id', itemId);

  if (updateErr) {
    console.error('[kitchen/update-item-status] update error', updateErr);
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
  }

  // When this item just became 'ready', check if all non-served items on the
  // ticket are now ready — if so, fire a kitchen_ready notification.
  if (status === 'ready') {
    try {
      const { data: remainingItems } = await supabase
        .from('ticket_items')
        .select('id, name, qty, kitchen_status')
        .eq('ticket_id', item.ticket_id)
        .neq('kitchen_status', 'served');

      const allReady = (remainingItems ?? []).every(
        (it: any) => it.id === itemId || it.kitchen_status === 'ready',
      );

      if (allReady && (remainingItems ?? []).length > 0) {
        const customerData = (ticket.customer_data as Record<string, unknown>) ?? {};
        const tableLabel = Array.isArray(ticket.restaurant_tables)
          ? ticket.restaurant_tables[0]?.label ?? null
          : (ticket.restaurant_tables as any)?.label ?? null;

        await supabase.from('notifications').insert({
          ticket_id: item.ticket_id,
          type: 'kitchen_ready',
          channel: 'in_app',
          payload: {
            ticket_id: item.ticket_id,
            ticket_number: ticket.ticket_number ?? null,
            table_label: tableLabel ?? null,
            office_id: officeId,
            organization_id: item.organization_id,
            party_size: customerData?.party_size ?? null,
            customer_name: (customerData?.name ?? customerData?.customer_name ?? null),
            items: (remainingItems ?? []).map((i: any) => ({ name: i.name, qty: i.qty })),
            ready_at: now,
          },
          sent_at: now,
        } as any);
      }
    } catch (notifErr) {
      // Non-fatal — the UI is already updated; notification failure should not
      // roll back the kitchen_status write.
      console.warn('[kitchen/update-item-status] notification insert failed', notifErr);
    }
  }

  return NextResponse.json({ ok: true });
}
