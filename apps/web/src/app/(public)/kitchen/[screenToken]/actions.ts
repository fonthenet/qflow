'use server';

/**
 * Server actions for the web Kitchen Display System (KDS).
 *
 * Auth model: screen token is the sole credential — same as the page
 * resolution. We re-validate the token on every call via
 * resolveKitchenScreenToken() before any write, so a stale or forged token
 * cannot mutate data that doesn't belong to the resolved office.
 *
 * Idempotency: every action is safe to replay. If the requested status
 * already matches the current value, the DB write is skipped and { ok: true,
 * noop: true } is returned. This mirrors the Meta-webhook dedup discipline
 * from the project rules.
 *
 * Notifications: when all non-served items on a ticket flip to 'ready', a
 * notifications row (type='kitchen_ready') is inserted so Station + Expo
 * operator apps receive an instant in-app alert. The payload shape mirrors
 * apps/expo/lib/data-adapter.ts bumpTicketKitchen() exactly, so receiver-
 * side code in both apps works without changes.
 *
 * These server actions are the canonical write interface for the web KDS page.
 * The parallel /api/kitchen/* route handlers expose the same logic over HTTP
 * for Station and Expo — they share the same resolveKitchenScreenToken()
 * helper so the validation path is identical.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { resolveKitchenScreenToken } from '@/lib/kitchen/resolve-screen-token';
import { notifyCustomerOnKitchenReady } from '@/lib/kitchen/notify-customer-ready';

export type KitchenItemStatus = 'new' | 'in_progress' | 'ready' | 'served';

export interface ActionResult {
  ok: boolean;
  noop?: boolean;
  error?: string;
}

// ── updateKitchenItemStatus ─────────────────────────────────────────────────

/**
 * Advance (or un-bump) a single ticket item's kitchen_status.
 *
 * Steps:
 *   1. Resolve screenToken → { officeId, organizationId }
 *   2. Fetch the item; verify its parent ticket belongs to the resolved office
 *   3. No-op when status already matches (idempotent)
 *   4. Write kitchen_status + kitchen_status_at
 *   5. When nextStatus === 'ready' AND all non-served items on the ticket are
 *      now ready → insert a notifications row { type: 'kitchen_ready' }
 */
export async function updateKitchenItemStatus(
  screenToken: string,
  itemId: string,
  nextStatus: KitchenItemStatus,
): Promise<ActionResult> {
  const VALID_STATUSES: KitchenItemStatus[] = ['new', 'in_progress', 'ready', 'served'];

  if (!screenToken || !itemId) {
    return { ok: false, error: 'screenToken and itemId are required' };
  }
  if (!VALID_STATUSES.includes(nextStatus)) {
    return { ok: false, error: `Invalid status: ${nextStatus}` };
  }

  const resolved = await resolveKitchenScreenToken(screenToken);
  if (!resolved) {
    return { ok: false, error: 'Invalid screen token' };
  }

  const { officeId } = resolved;
  const supabase = createAdminClient();

  // Fetch item + verify office ownership via parent ticket.
  const { data: item, error: itemErr } = await supabase
    .from('ticket_items')
    .select('id, kitchen_status, ticket_id, organization_id')
    .eq('id', itemId)
    .maybeSingle();

  if (itemErr || !item) {
    return { ok: false, error: 'Item not found' };
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, customer_data, restaurant_tables!current_ticket_id(label)')
    .eq('id', item.ticket_id)
    .maybeSingle();

  if (!ticket || ticket.office_id !== officeId) {
    return { ok: false, error: 'Item does not belong to this office' };
  }

  // Idempotency — no-op when already at requested status.
  if (item.kitchen_status === nextStatus) {
    return { ok: true, noop: true };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('ticket_items')
    .update({ kitchen_status: nextStatus, kitchen_status_at: now } as any)
    .eq('id', itemId);

  if (updateErr) {
    console.error('[actions/updateKitchenItemStatus] update error', updateErr);
    return { ok: false, error: 'Database update failed' };
  }

  // When flipping to 'ready', check if all non-served items are now ready.
  if (nextStatus === 'ready') {
    try {
      const { data: siblingItems } = await supabase
        .from('ticket_items')
        .select('id, name, qty, kitchen_status')
        .eq('ticket_id', item.ticket_id)
        .neq('kitchen_status', 'served');

      const allReady = (siblingItems ?? []).every(
        (it: any) => it.id === itemId || it.kitchen_status === 'ready',
      );

      if (allReady && (siblingItems ?? []).length > 0) {
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
            items: (siblingItems ?? []).map((i: any) => ({ name: i.name, qty: i.qty })),
            ready_at: now,
          },
          sent_at: now,
        } as any);

        // Customer-facing WA "ready" message — only fires for online
        // takeout/delivery orders; walk-in/dine-in are filtered out
        // inside the helper. Best-effort, no rollback on failure.
        void notifyCustomerOnKitchenReady(supabase, item.ticket_id);
      }
    } catch (notifErr) {
      // Non-fatal — the UI write succeeded; notification failure must not
      // roll back the kitchen_status update.
      console.warn('[actions/updateKitchenItemStatus] notification insert failed', notifErr);
    }
  }

  return { ok: true };
}

// ── markAllItemsOnTicket ────────────────────────────────────────────────────

/**
 * Bulk-advance all non-served items on a ticket to nextStatus ('ready' or
 * 'served'). Used by the card-level "Mark all ready" / "Mark all served"
 * buttons.
 *
 * Steps:
 *   1. Resolve screenToken → officeId
 *   2. Verify the ticket belongs to the resolved office
 *   3. UPDATE ticket_items WHERE ticket_id = ticketId AND kitchen_status != 'served'
 *   4. When nextStatus === 'ready' → insert a kitchen_ready notification
 *
 * Idempotent: items already at 'served' are excluded by the filter; calling
 * with nextStatus='ready' when all items are already ready is a harmless
 * no-op at the DB level (UPDATE ... SET kitchen_status='ready' WHERE
 * kitchen_status != 'served' and all non-served items are already ready
 * writes zero rows).
 */
export async function markAllItemsOnTicket(
  screenToken: string,
  ticketId: string,
  nextStatus: 'ready' | 'served',
): Promise<ActionResult> {
  if (!screenToken || !ticketId) {
    return { ok: false, error: 'screenToken and ticketId are required' };
  }
  if (nextStatus !== 'ready' && nextStatus !== 'served') {
    return { ok: false, error: 'nextStatus must be "ready" or "served"' };
  }

  const resolved = await resolveKitchenScreenToken(screenToken);
  if (!resolved) {
    return { ok: false, error: 'Invalid screen token' };
  }

  const { officeId } = resolved;
  const supabase = createAdminClient();

  // Verify ticket belongs to the resolved office.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, customer_data, restaurant_tables!current_ticket_id(label)')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket || ticket.office_id !== officeId) {
    return { ok: false, error: 'Ticket does not belong to this office' };
  }

  const now = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from('ticket_items')
    .update({ kitchen_status: nextStatus, kitchen_status_at: now } as any)
    .eq('ticket_id', ticketId)
    .neq('kitchen_status', 'served');

  if (updateErr) {
    console.error('[actions/markAllItemsOnTicket] update error', updateErr);
    return { ok: false, error: 'Database update failed' };
  }

  // Insert kitchen_ready notification when marking all ready.
  // Payload shape mirrors apps/expo/lib/data-adapter.ts bumpTicketKitchen().
  if (nextStatus === 'ready') {
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

      // Customer-facing "ready" WA message for online orders only.
      void notifyCustomerOnKitchenReady(supabase, ticketId);
    } catch (notifErr) {
      // Non-fatal — see rationale in updateKitchenItemStatus.
      console.warn('[actions/markAllItemsOnTicket] notification insert failed', notifErr);
    }
  }

  return { ok: true };
}
