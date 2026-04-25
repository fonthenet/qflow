/**
 * Data Adapter — routes all ticket/queue operations to either
 * Supabase (cloud mode) or Station HTTP API (local mode).
 *
 * Screens import from here instead of ticket-actions.ts directly.
 */

import { useLocalConnectionStore } from './local-connection-store';
import * as Cloud from './ticket-actions';
import * as Station from './station-client';

function getLocal() {
  const { mode, stationUrl, stationSession } = useLocalConnectionStore.getState();
  if (mode === 'local' && stationUrl && stationSession) {
    return { url: stationUrl, session: stationSession };
  }
  return null;
}

// ── Call Next ────────────────────────────────────────────────────

export async function callNextTicket(deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    const officeId = local.session.office_id;
    return Station.stationCallNext(local.url, officeId, deskId, staffId);
  }
  return Cloud.callNextTicket(deskId, staffId);
}

// ── Call Specific Ticket ─────────────────────────────────────────

export async function callSpecificTicket(ticketId: string, deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
    });
  }
  return Cloud.callSpecificTicket(ticketId, deskId, staffId);
}

// ── Start Serving ────────────────────────────────────────────────

export async function startServing(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'serving',
      serving_started_at: new Date().toISOString(),
    });
  }
  return Cloud.startServing(ticketId);
}

// ── Mark Served ──────────────────────────────────────────────────

export async function markServed(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'served',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.markServed(ticketId);
}

// ── Mark No-Show ─────────────────────────────────────────────────

export async function markNoShow(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'no_show',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.markNoShow(ticketId);
}

// ── Cancel Ticket ────────────────────────────────────────────────

export async function cancelTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.cancelTicket(ticketId);
}

// ── Recall ───────────────────────────────────────────────────────

export async function recallTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      called_at: new Date().toISOString(),
    });
  }
  return Cloud.recallTicket(ticketId);
}

// ── Reset to Queue ───────────────────────────────────────────────

export async function resetToQueue(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    });
  }
  return Cloud.resetToQueue(ticketId);
}

// ── Park Ticket ──────────────────────────────────────────────────

export async function parkTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: new Date().toISOString(),
    });
  }
  return Cloud.parkTicket(ticketId);
}

// ── Resume Parked Ticket (call to desk) ──────────────────────────

export async function resumeParkedTicket(ticketId: string, deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
      parked_at: null,
    });
  }
  return Cloud.resumeParkedTicket(ticketId, deskId, staffId);
}

// ── Unpark to Queue ──────────────────────────────────────────────

export async function unparkToQueue(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      parked_at: null,
    });
  }
  return Cloud.unparkToQueue(ticketId);
}

// ── Desk Status ──────────────────────────────────────────────────

export async function openDesk(deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'open', current_staff_id: staffId });
  }
  return Cloud.openDesk(deskId, staffId);
}

export async function closeDeskStatus(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'closed' });
  }
  return Cloud.closeDeskStatus(deskId);
}

export async function setDeskOnBreak(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'on_break' });
  }
  return Cloud.setDeskOnBreak(deskId);
}

export async function setDeskOpen(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'open' });
  }
  return Cloud.setDeskOpen(deskId);
}

// ── Desk Heartbeat ───────────────────────────────────────────────

export async function pingDeskHeartbeat(deskId: string) {
  const local = getLocal();
  if (local) return; // Station manages its own heartbeat
  return Cloud.pingDeskHeartbeat(deskId);
}

// ── Safety functions (cloud-only, Station handles these internally) ──

export async function requeueExpiredCalls(timeoutSeconds = 90) {
  const local = getLocal();
  if (local) return 0; // Station handles this
  return Cloud.requeueExpiredCalls(timeoutSeconds);
}

export async function autoResolveTickets() {
  const local = getLocal();
  if (local) return {}; // Station handles this
  return Cloud.autoResolveTickets();
}

// ── Fetch Available Desks (local-aware) ─────────────────────────

export async function fetchAvailableDesks(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'desks', [officeId]);
  }
  return Cloud.fetchAvailableDesks(officeId);
}

// ── Switch Desk (local-aware) ───────────────────────────────────

export async function switchDesk(deskId: string, staffId: string, oldDeskId?: string | null) {
  const local = getLocal();
  if (local) {
    // In local mode, query desks and return the selected one
    const desks = await Station.stationQuery(local.url, 'desks', [local.session.office_id]);
    const desk = desks.find((d: any) => d.id === deskId);
    if (!desk) throw new Error('Desk not found');
    return desk;
  }
  return Cloud.switchDesk(deskId, staffId, oldDeskId);
}

// ── Create In-House Ticket (local-aware) ────────────────────────

export async function createInHouseTicket(params: {
  officeId: string;
  departmentId: string;
  serviceId?: string;
  customerName?: string;
  customerPhone?: string;
  visitReason?: string;
  priority?: number;
  priorityCategoryId?: string | null;
}) {
  const local = getLocal();
  if (local) {
    const res = await Station.stationCreateTicket(local.url, {
      officeId: params.officeId,
      departmentId: params.departmentId,
      serviceId: params.serviceId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerReason: params.visitReason,
      source: 'in_house',
    });
    // Station returns { ticket: { ... } } — unwrap and normalize
    const t = res.ticket ?? res;
    return {
      id: t.id,
      ticket_number: t.ticket_number,
      qr_token: t.qr_token ?? null,
      qr_data_url: t.qr_data_url ?? null,
      position: t.position,
      estimated_wait: t.estimated_wait,
      whatsappStatus: t.whatsappStatus ?? res.whatsappStatus,
    };
  }
  return Cloud.createInHouseTicket(params);
}

// ── Restaurant table mutations (local-aware) ────────────────────
//
// Single source of truth for writes to `restaurant_tables`. Both web/Station
// and Expo go through these so the FloorMap, TableSuggestion and any future
// consumer never see a stale row in either mode:
//   • cloud mode  → write Supabase directly (RLS-protected)
//   • local mode  → POST to the Station bridge → SQLite + sync queue
//
// `seatTicketAtTable` seats a ticket; `releaseTableForTicket` clears whatever
// table a ticket is bound to (called when a ticket terminates).

// ── Seat a NEW party at a table (restaurant/cafe multi-party flow) ──
//
// In tables-mode verticals (restaurant, café) a single host runs many
// parties in parallel — the per-desk "one active ticket" trigger does
// NOT apply. This action moves the ticket from waiting → serving and
// binds it to a table WITHOUT setting desk_id, so the DB trigger that
// guards desk capacity (1-active-per-desk) is bypassed cleanly.
//
//   • status         → 'serving'   (host seated them; service has started)
//   • serving_started_at, called_at → now
//   • called_by_staff_id → who seated the party
//   • desk_id        → left NULL (the floor, not a single desk, owns it)
//   • table binding  → via seatTicketAtTable
//
// The action sheet's "Mark served / Move / Release / Recall" actions
// then operate on these multi-party tickets just fine — they only need
// the ticket id, not the desk binding.
export async function seatPartyAtTable(
  officeId: string,
  tableLabelOrCode: string,
  ticketId: string,
  staffId: string,
) {
  const now = new Date().toISOString();
  const local = getLocal();
  if (local) {
    // Local mode: bridge takes a generic update, then bind table.
    await Station.stationUpdateTicket(local.url, ticketId, {
      status: 'serving',
      called_at: now,
      serving_started_at: now,
      called_by_staff_id: staffId,
    });
    return Station.stationUpdateTable(local.url, {
      officeId,
      tableLabel: tableLabelOrCode,
      ticketId,
      status: 'occupied',
    });
  }
  const { supabase } = await import('./supabase');
  // 1) Promote ticket to serving, NO desk_id (bypass 1-per-desk trigger).
  const { error: tErr } = await (supabase as any)
    .from('tickets')
    .update({
      status: 'serving',
      called_at: now,
      serving_started_at: now,
      called_by_staff_id: staffId,
    })
    .eq('id', ticketId);
  if (tErr) throw new Error(tErr.message);
  // 2) Bind table — re-uses seatTicketAtTable's lookup + auto-release logic.
  return seatTicketAtTable(officeId, tableLabelOrCode, ticketId);
}

// ── Notify a waiting customer that their table is ready ──────────
//
// Restaurant/cafe flow: host wants to ping the next party (over their
// chosen channel — WhatsApp, Messenger, push) WITHOUT binding them to
// a desk. The trigger that enforces "one active ticket per desk" only
// fires when desk_id IS NOT NULL, so we set status='called' with NO
// desk_id. The actual notification is sent via the unified
// /api/ticket-transition endpoint (skipStatusUpdate: true) so we
// don't double-write the row.
export async function notifyTableReady(ticketId: string, staffId: string) {
  const now = new Date().toISOString();
  const local = getLocal();
  if (local) {
    await Station.stationUpdateTicket(local.url, ticketId, {
      status: 'called',
      called_at: now,
      called_by_staff_id: staffId,
    });
  } else {
    const { supabase } = await import('./supabase');
    const { error } = await (supabase as any)
      .from('tickets')
      .update({
        status: 'called',
        called_at: now,
        called_by_staff_id: staffId,
      })
      .eq('id', ticketId);
    if (error) throw new Error(error.message);
  }
  // Fire the channel notification (WhatsApp / Messenger / push). We
  // skipStatusUpdate because we just set status above. Failure to
  // notify shouldn't roll back the status flip — surface it but don't
  // throw.
  try {
    const { triggerNotification } = await import('./ticket-actions');
    await triggerNotification(ticketId, 'called');
  } catch (err) {
    console.warn('[notifyTableReady] notification failed', err);
  }
}

export async function seatTicketAtTable(
  officeId: string,
  tableLabelOrCode: string,
  ticketId: string,
) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTable(local.url, {
      officeId,
      tableLabel: tableLabelOrCode,
      ticketId,
      status: 'occupied',
    });
  }
  const { supabase } = await import('./supabase');
  // Look up the row by label or code, then update.
  const { data: rows } = await (supabase as any)
    .from('restaurant_tables')
    .select('id')
    .eq('office_id', officeId)
    .or(`label.eq.${tableLabelOrCode},code.eq.${tableLabelOrCode}`);
  const row = rows && rows[0];
  if (!row) throw new Error(`Table not found: ${tableLabelOrCode}`);
  // Release any other row currently holding the same ticket.
  await (supabase as any)
    .from('restaurant_tables')
    .update({ status: 'available', current_ticket_id: null, assigned_at: null })
    .eq('current_ticket_id', ticketId)
    .neq('id', row.id);
  const { data, error } = await (supabase as any)
    .from('restaurant_tables')
    .update({
      status: 'occupied',
      current_ticket_id: ticketId,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function seatTicketAtTableId(
  officeId: string,
  tableId: string,
  ticketId: string,
) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTable(local.url, {
      officeId,
      tableId,
      ticketId,
      status: 'occupied',
    });
  }
  const { supabase } = await import('./supabase');
  await (supabase as any)
    .from('restaurant_tables')
    .update({ status: 'available', current_ticket_id: null, assigned_at: null })
    .eq('current_ticket_id', ticketId)
    .neq('id', tableId);
  const { data, error } = await (supabase as any)
    .from('restaurant_tables')
    .update({
      status: 'occupied',
      current_ticket_id: ticketId,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', tableId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function releaseTableForTicket(officeId: string, ticketId: string) {
  const local = getLocal();
  if (local) {
    try {
      return await Station.stationReleaseTableForTicket(local.url, { officeId, ticketId });
    } catch (e) {
      console.warn('[data-adapter] releaseTableForTicket (local) failed', e);
      return { released: 0 };
    }
  }
  try {
    const { supabase } = await import('./supabase');
    await (supabase as any)
      .from('restaurant_tables')
      .update({ status: 'available', current_ticket_id: null, assigned_at: null })
      .eq('current_ticket_id', ticketId);
  } catch (e) {
    console.warn('[data-adapter] releaseTableForTicket (cloud) failed', e);
  }
  return { released: 0 };
}

export async function clearTableById(officeId: string, tableId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTable(local.url, {
      officeId,
      tableId,
      ticketId: null,
      status: 'available',
    });
  }
  const { supabase } = await import('./supabase');
  const { error } = await (supabase as any)
    .from('restaurant_tables')
    .update({ status: 'available', current_ticket_id: null, assigned_at: null })
    .eq('id', tableId);
  if (error) throw error;
  return { ok: true };
}

// ── Fetch Restaurant Tables (local-aware) ───────────────────────

export async function fetchRestaurantTables(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'restaurant_tables', [officeId]);
  }
  // Cloud path — query Supabase directly. Imported lazily to avoid pulling
  // the supabase client into local-only callers.
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('restaurant_tables')
    .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
    .eq('office_id', officeId)
    .order('code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}

// ── Fetch Departments (local-aware) ─────────────────────────────

export async function fetchOfficeDepartments(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'departments', [officeId]);
  }
  return Cloud.fetchOfficeDepartments(officeId);
}

// ── Fetch Services (local-aware) ────────────────────────────────

export async function fetchDepartmentServices(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'services', [officeId]);
  }
  return Cloud.fetchDepartmentServices(officeId);
}

// ── Transfer Ticket (local-aware) ───────────────────────────────

export async function transferTicket(
  ticketId: string,
  newDepartmentId: string,
  newServiceId?: string | null,
) {
  const local = getLocal();
  if (local) {
    // In local mode, cancel old ticket and create new one in the new department
    await Station.stationUpdateTicket(local.url, ticketId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      notes: 'Transferred',
    });
    return Station.stationCreateTicket(local.url, {
      officeId: local.session.office_id,
      departmentId: newDepartmentId,
      serviceId: newServiceId ?? undefined,
      source: 'transfer',
    });
  }
  return Cloud.transferTicket(ticketId, newDepartmentId, newServiceId);
}

// ── Menu / Orders / Payments ─────────────────────────────────────
//
// These flow ALWAYS through Supabase (cloud), even when the rest of
// the app is in Station local-mode. Reasoning:
//
//   • Menu data is small and rarely written; the Station already has
//     it in local SQLite via its own sync loop, so Expo writing direct
//     to Supabase doesn't desync the operator desk — Station picks up
//     the new ticket_items + payments rows on its next pull.
//   • Adding new Station HTTP endpoints + IPC handlers for every CRUD
//     op (categories, items, ticket_items, payments) would double the
//     surface area for a feature that's primarily mobile-first.
//   • RLS on `menu_categories` / `menu_items` / `ticket_items` /
//     `ticket_payments` already restricts staff to their org, so the
//     mobile client is safe to write directly.
//
// If you ever need offline menu support on the mobile app, add Station
// HTTP endpoints in `apps/desktop/electron/kiosk-server.ts` and route
// here on `getLocal()`. The cloud path stays as the fallback.

import type { MenuCategory, MenuItem, TicketItem, TicketPayment } from '@qflo/shared';

export async function fetchMenuCategories(orgId: string): Promise<MenuCategory[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('menu_categories')
    .select('*')
    .eq('organization_id', orgId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MenuCategory[];
}

export async function fetchMenuItems(orgId: string): Promise<MenuItem[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('menu_items')
    .select('*')
    .eq('organization_id', orgId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MenuItem[];
}

export async function fetchTicketItems(ticketId: string): Promise<TicketItem[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('ticket_items')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TicketItem[];
}

/**
 * Add an item line to a ticket. Snapshots `name` + already-discounted
 * `price` so future menu edits don't rewrite history.
 */
export async function addTicketItem(args: {
  ticketId: string;
  organizationId: string;
  menuItemId: string | null;
  name: string;
  price: number | null;
  qty: number;
  note?: string | null;
  addedBy?: string | null;
}): Promise<TicketItem> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('ticket_items')
    .insert({
      ticket_id: args.ticketId,
      organization_id: args.organizationId,
      menu_item_id: args.menuItemId,
      name: args.name,
      price: args.price,
      qty: args.qty,
      note: args.note ?? null,
      added_at: new Date().toISOString(),
      added_by: args.addedBy ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as TicketItem;
}

export async function updateTicketItem(
  itemId: string,
  patch: Partial<Pick<TicketItem, 'qty' | 'note' | 'price' | 'name'>>,
): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await (supabase as any)
    .from('ticket_items')
    .update(patch)
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

export async function deleteTicketItem(itemId: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await (supabase as any)
    .from('ticket_items')
    .delete()
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

/**
 * Given a list of ticket IDs, return the subset that has at least one
 * `ticket_items` row. Used by the FloorMap to show a "food served" or
 * "order placed" badge on tables whose seated ticket already has items
 * — gives the operator at-a-glance visibility into which parties have
 * been ordered for vs. waiting on the menu.
 */
export async function fetchTicketIdsWithItems(ticketIds: string[]): Promise<Set<string>> {
  if (!ticketIds.length) return new Set();
  const local = getLocal();
  if (local) {
    // Local Station bridge — stationQuery has a hard-coded allowlist that
    // doesn't include `ticket_items`, so fan out per ticket via
    // fetchTicketItems (which uses the dedicated stationGetTicketItems
    // bridge endpoint). Cheap because tickets are short-lived and we
    // only hit this for currently-active ones.
    try {
      const results = await Promise.all(
        ticketIds.map((id) =>
          fetchTicketItems(id).then((items) => (items.length > 0 ? id : null)).catch(() => null),
        ),
      );
      return new Set(results.filter((x): x is string => !!x));
    } catch {
      return new Set();
    }
  }
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('ticket_items')
    .select('ticket_id')
    .in('ticket_id', ticketIds);
  if (error) return new Set();
  return new Set((data ?? []).map((r: any) => r.ticket_id));
}

// ── Kitchen Display System (KDS) helpers ───────────────────────────
//
// These power the /kitchen screen for restaurant/cafe verticals. The
// KDS surfaces every active ticket (status in 'serving','called') that
// has at least one un-served item and lets cooks bump items through
// new → in_progress → ready → served. Servers / expo see the same
// data updated via realtime.

export interface KitchenTicket {
  ticket_id: string;
  ticket_number: string;
  table_label: string | null;
  party_size: number | string | null;
  customer_name: string | null;
  ticket_status: string;
  /** Earliest `added_at` of any non-served item — drives the "age"
   *  badge so the oldest ticket bubbles up + turns red. */
  oldest_item_at: string;
  items: TicketItem[];
}

/**
 * List active tickets for the org with their non-served items, ready to
 * be rendered as kitchen cards. Sorted by oldest fired item first so
 * the kitchen always works the longest-waiting party first.
 *
 * Cloud-only for now — when local-mode kitchen tablets land we'll add
 * a Station bridge endpoint. The screen falls back gracefully if the
 * org is in local mode (renders an empty state with a hint).
 */
export async function fetchKitchenTickets(orgId: string): Promise<KitchenTicket[]> {
  const local = getLocal();
  if (local) {
    // Local mode not wired yet — return empty rather than crash.
    return [];
  }
  const { supabase } = await import('./supabase');
  // Pull active tickets first (cheaper than starting from items + de-duping).
  const { data: tickets, error: tErr } = await (supabase as any)
    .from('tickets')
    .select('id, ticket_number, table_label, customer_data, status')
    .eq('organization_id', orgId)
    .in('status', ['called', 'serving'])
    .order('created_at', { ascending: true });
  if (tErr) throw new Error(tErr.message);
  if (!tickets?.length) return [];

  const ids = tickets.map((t: any) => t.id);
  const { data: items, error: iErr } = await (supabase as any)
    .from('ticket_items')
    .select('*')
    .in('ticket_id', ids)
    .neq('kitchen_status', 'served')
    .order('added_at', { ascending: true });
  if (iErr) throw new Error(iErr.message);

  const byTicket = new Map<string, TicketItem[]>();
  for (const it of (items ?? []) as TicketItem[]) {
    const arr = byTicket.get(it.ticket_id) ?? [];
    arr.push(it);
    byTicket.set(it.ticket_id, arr);
  }

  const cards: KitchenTicket[] = [];
  for (const tk of tickets as any[]) {
    const its = byTicket.get(tk.id);
    if (!its || its.length === 0) continue; // No food = no kitchen card.
    const oldest = its.reduce(
      (acc, it) => (it.added_at < acc ? it.added_at : acc),
      its[0].added_at,
    );
    cards.push({
      ticket_id: tk.id,
      ticket_number: tk.ticket_number,
      table_label: tk.table_label ?? null,
      party_size: tk.customer_data?.party_size ?? null,
      customer_name: tk.customer_data?.name ?? null,
      ticket_status: tk.status,
      oldest_item_at: oldest,
      items: its,
    });
  }

  // Oldest-fired-item first so the most urgent card sits at the top.
  cards.sort((a, b) => a.oldest_item_at.localeCompare(b.oldest_item_at));
  return cards;
}

/**
 * Advance a single item's kitchen status. Idempotent — called from the
 * KDS when a cook taps the per-item button. Stamps `kitchen_status_at`
 * so we can compute "time in stage" later (analytics, SLA dashboards).
 */
export async function updateItemKitchenStatus(
  itemId: string,
  status: 'new' | 'in_progress' | 'ready' | 'served',
): Promise<void> {
  const local = getLocal();
  if (local) {
    // No local bridge yet for per-item kitchen status — skip silently.
    return;
  }
  const { supabase } = await import('./supabase');
  const { error } = await (supabase as any)
    .from('ticket_items')
    .update({ kitchen_status: status, kitchen_status_at: new Date().toISOString() })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}

/**
 * Bulk-advance every non-served item on a ticket to `status`. Powers
 * the card-level "Mark all ready" / "Bump all" shortcut. Single
 * round-trip — much cheaper than per-item updates when a card has 8+
 * lines.
 */
export async function bumpTicketKitchen(
  ticketId: string,
  status: 'in_progress' | 'ready' | 'served',
): Promise<void> {
  const local = getLocal();
  if (local) return;
  const { supabase } = await import('./supabase');
  const now = new Date().toISOString();
  const { error } = await (supabase as any)
    .from('ticket_items')
    .update({ kitchen_status: status, kitchen_status_at: now })
    .eq('ticket_id', ticketId)
    .neq('kitchen_status', 'served');
  if (error) throw new Error(error.message);

  // When the kitchen marks the whole ticket "ready", insert a notification
  // row so other staff devices (Station, other operator phones) get an
  // instant in-app alert with the table label + items list. RLS scopes
  // notifications per-org; we filter receiver-side by office_id.
  if (status === 'ready') {
    try {
      const { data: tk } = await (supabase as any)
        .from('tickets')
        .select('id, ticket_number, office_id, customer_data, restaurant_tables!current_ticket_id(label)')
        .eq('id', ticketId)
        .maybeSingle();
      const { data: items } = await (supabase as any)
        .from('ticket_items')
        .select('name, qty, organization_id')
        .eq('ticket_id', ticketId)
        .order('added_at', { ascending: true });
      const orgId: string | null = items?.[0]?.organization_id ?? null;
      const customer = tk?.customer_data ?? {};
      const tableLabel = Array.isArray(tk?.restaurant_tables)
        ? tk.restaurant_tables[0]?.label
        : tk?.restaurant_tables?.label ?? null;
      await (supabase as any).from('notifications').insert({
        ticket_id: ticketId,
        type: 'kitchen_ready',
        channel: 'in_app',
        payload: {
          ticket_id: ticketId,
          ticket_number: tk?.ticket_number ?? null,
          table_label: tableLabel ?? null,
          office_id: tk?.office_id ?? null,
          organization_id: orgId,
          party_size: customer?.party_size ?? null,
          customer_name: customer?.name ?? null,
          items: (items ?? []).map((i: any) => ({ name: i.name, qty: i.qty })),
          ready_at: now,
        },
        sent_at: now,
      });
    } catch { /* non-fatal — UI already updated */ }
  }
}

/**
 * List existing payments for a ticket, oldest first. Used by the desk
 * action sheet + Mark Served confirmation to show what's already been
 * collected before the ticket is closed.
 */
export async function fetchTicketPayments(ticketId: string): Promise<TicketPayment[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('ticket_payments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('paid_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TicketPayment[];
}

/**
 * Record a payment against a ticket. Returns the created payment row.
 * Caller is responsible for separately marking the ticket as served.
 */
export async function createTicketPayment(args: {
  ticketId: string;
  organizationId: string;
  method: TicketPayment['method'];
  amount: number;
  tendered?: number | null;
  changeGiven?: number | null;
  note?: string | null;
  paidBy?: string | null;
}): Promise<TicketPayment> {
  const { supabase } = await import('./supabase');
  const { data, error } = await (supabase as any)
    .from('ticket_payments')
    .insert({
      ticket_id: args.ticketId,
      organization_id: args.organizationId,
      method: args.method,
      amount: args.amount,
      tendered: args.tendered ?? null,
      change_given: args.changeGiven ?? null,
      note: args.note ?? null,
      paid_at: new Date().toISOString(),
      paid_by: args.paidBy ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as TicketPayment;
}

// ── Re-export unchanged functions (cloud/admin-only features) ───

export {
  adjustBookingPriorities,
  cleanupStaleTickets,
  createStaff,
  updateStaff,
  createDesk,
  updateDesk,
  deleteDesk,
  createOffice,
  updateOffice,
  deleteOffice,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createService,
  updateService,
  deleteService,
  createPriority,
  updatePriority,
  deletePriority,
  fetchAppointments,
  checkInAppointment,
  cancelAppointment,
  approveAppointment,
  declineAppointment,
  noShowAppointment,
  completeAppointment,
  deleteAppointment,
  fetchVirtualCodes,
  createVirtualCode,
  toggleVirtualCode,
  deleteVirtualCode,
} from './ticket-actions';
