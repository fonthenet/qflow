/**
 * POST /api/kitchen/bulk-update-ticket
 *
 * Body: { screenToken: string, ticketId: string, action: 'mark_all_ready' | 'mark_all_served' }
 *
 * Single SQL UPDATE that advances every non-served item on a ticket to
 * 'ready' or 'served'. Same semantics as bumpTicketKitchen() in
 * apps/expo/lib/data-adapter.ts — designed for the card-level shortcut
 * buttons ("Mark all ready" / "Mark all served").
 *
 * Idempotent: items already at the target status are skipped by the
 * `neq('kitchen_status', 'served')` guard (and for mark_all_ready by the
 * neq on 'ready' filter). Duplicate POST calls are harmless.
 *
 * Inserts kitchen_ready notification when action='mark_all_ready', mirroring
 * the Expo bumpTicketKitchen payload shape so existing operator-app receivers
 * work without changes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveKitchenScreenToken } from '@/lib/kitchen/resolve-screen-token';

const VALID_ACTIONS = new Set(['mark_all_ready', 'mark_all_served']);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { screenToken, ticketId, action } = body as Record<string, unknown>;

  if (typeof screenToken !== 'string' || !screenToken) {
    return NextResponse.json({ error: 'screenToken required' }, { status: 400 });
  }
  if (typeof ticketId !== 'string' || !ticketId) {
    return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
  }
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: 'action must be "mark_all_ready" or "mark_all_served"' },
      { status: 400 },
    );
  }

  const resolved = await resolveKitchenScreenToken(screenToken);
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid screen token' }, { status: 404 });
  }

  const { officeId } = resolved;
  const supabase = createAdminClient();

  // Verify the ticket belongs to the resolved office.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, customer_data, restaurant_tables!current_ticket_id(label)')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket || ticket.office_id !== officeId) {
    return NextResponse.json({ error: 'Ticket does not belong to this office' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const targetStatus = action === 'mark_all_served' ? 'served' : 'ready';

  // Single UPDATE — skip already-served items (safe for both actions).
  const { error: updateErr } = await supabase
    .from('ticket_items')
    .update({ kitchen_status: targetStatus, kitchen_status_at: now } as any)
    .eq('ticket_id', ticketId)
    .neq('kitchen_status', 'served');

  if (updateErr) {
    console.error('[kitchen/bulk-update-ticket] update error', updateErr);
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
  }

  // Insert kitchen_ready notification when marking all ready.
  // Payload mirrors apps/expo/lib/data-adapter.ts bumpTicketKitchen() exactly.
  if (action === 'mark_all_ready') {
    try {
      const { data: items } = await supabase
        .from('ticket_items')
        .select('name, qty, organization_id')
        .eq('ticket_id', ticketId)
        .order('added_at', { ascending: true });

      const orgId: string | null = (items as any)?.[0]?.organization_id ?? null;
      const customerData = (ticket.customer_data as Record<string, unknown>) ?? {};
      const tableLabel = Array.isArray(ticket.restaurant_tables)
        ? ticket.restaurant_tables[0]?.label ?? null
        : (ticket.restaurant_tables as any)?.label ?? null;

      await supabase.from('notifications').insert({
        ticket_id: ticketId,
        type: 'kitchen_ready',
        channel: 'in_app',
        payload: {
          ticket_id: ticketId,
          ticket_number: ticket.ticket_number ?? null,
          table_label: tableLabel ?? null,
          office_id: officeId,
          organization_id: orgId,
          party_size: customerData?.party_size ?? null,
          customer_name: (customerData?.name ?? customerData?.customer_name ?? null),
          items: (items ?? []).map((i: any) => ({ name: i.name, qty: i.qty })),
          ready_at: now,
        },
        sent_at: now,
      } as any);
    } catch (notifErr) {
      // Non-fatal — see update-item-status route for rationale.
      console.warn('[kitchen/bulk-update-ticket] notification insert failed', notifErr);
    }
  }

  return NextResponse.json({ ok: true });
}
