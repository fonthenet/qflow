/**
 * QueueOrdersCanvas — multi-ticket canvas for restaurant takeout/delivery
 * queue view.
 *
 * Shows all in-flight takeout/delivery tickets (called + serving + parked)
 * as a responsive card grid. Each card is a QueueOrderCard with inline item
 * list driven by local SQLite via IPC.
 *
 * Data:
 * - Items: bulk-fetched via `window.qf.ticketItems.listForTickets(ids)` on
 *   mount and on `ticketItems:changed` IPC event. Also polled every 4 s as
 *   a safety net.
 *
 * Layout:
 * - 1 col < 700 px, 2 col >= 700 px, 3 col >= 1100 px.
 * - Sticky "Call Next" button at bottom-right.
 *
 * Non-restaurant / non-restaurant-queue callers must NOT render this component
 * (the condition lives in Station.tsx).
 *
 * Theme: CSS vars only. RTL-safe logical props.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { resolveRestaurantServiceType, RESTAURANT_SERVICE_VISUALS, shouldShowServicePill } from '@qflo/shared';
import type { Ticket } from '../lib/types';
import {
  QueueOrderCard,
  ItemNoteEditor,
  aggregateKitchenStatus,
  type OrderCardItem,
} from './QueueOrderCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface QueueOrdersCanvasProps {
  tickets: Ticket[];          // in-flight takeout/delivery only (called+serving+parked)
  activeTicketId: string | null;
  waitingCount: number;       // for "Call Next" badge
  locale: DesktopLocale;
  serviceNames: Record<string, string>;   // service_id → name
  currency: string;
  decimals: number;
  queuePaused: boolean;
  // Actions
  onFocus: (ticketId: string) => void;
  onCallNext: () => void;
  onPark: (ticketId: string) => void;
  onResume: (ticketId: string) => void;
  onRecall: (ticketId: string) => void;
  onAddItems: (ticket: Ticket) => void;
  onCall: (ticketId: string) => void;          // waiting → called
  onStartServing: (ticketId: string) => void;
  onComplete: (ticketId: string) => void;
  onNoShow: (ticketId: string) => void;
  onCancel: (ticketId: string) => void;
  onBan: (ticketId: string) => void;
  onTransfer: (ticketId: string) => void;
  onRequeue: (ticketId: string) => void;
  onItemNote: (itemId: string, note: string) => void;
  /** Online-order Accept/Decline. Optional — only the queue canvas wires
   *  these; the FloorMap doesn't show pending_approval cards. */
  onAcceptOrder?: (ticketId: string, etaMinutes: number) => void;
  onDeclineOrder?: (ticketId: string, reasonKey: string, note: string) => void;
  /** Per-ticket suggested ETA in minutes (computed by parent from items'
   *  prep_time_minutes). Looked up by ticket id in the card render. */
  suggestedEtaMinutesByTicket?: Record<string, number>;
  /** Delivery dispatch handlers — surfaced only on delivery + serving cards. */
  onDispatchOrder?: (ticketId: string) => void;
  onArriveOrder?: (ticketId: string) => void;
  onDeliverOrder?: (ticketId: string) => void;
  /** Driver portal URL cache, keyed by ticketId. The Station owns this
   *  state (populated from /api/orders/dispatch responses). The canvas
   *  just looks up the URL per card and passes it down so each
   *  dispatched delivery card shows the copy/open buttons. */
  riderLinks?: Record<string, string>;
  onCopyRiderLink?: (ticketId: string) => void;
  /** In-house riders (active only) for the Assign dropdown. */
  availableRiders?: Array<{ id: string; name: string; phone: string; last_seen_at: string | null }>;
  /** Operator picked a rider — POST to /api/orders/assign. */
  onAssignRider?: (ticketId: string, riderId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const POLL_MS = 4000;

export function QueueOrdersCanvas({
  tickets,
  activeTicketId,
  waitingCount,
  locale,
  serviceNames,
  currency,
  decimals,
  queuePaused,
  onFocus,
  onCallNext,
  onPark,
  onResume,
  onRecall,
  onAddItems,
  onCall,
  onStartServing,
  onComplete,
  onNoShow,
  onCancel,
  onBan,
  onTransfer,
  onRequeue,
  onItemNote,
  onAcceptOrder,
  onDeclineOrder,
  suggestedEtaMinutesByTicket,
  onDispatchOrder,
  onArriveOrder,
  onDeliverOrder,
  riderLinks,
  onCopyRiderLink,
  availableRiders,
  onAssignRider,
}: QueueOrdersCanvasProps) {
  const tl = (key: string, values?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, values);

  // items: ticketId → OrderCardItem[]
  const [itemsMap, setItemsMap] = useState<Record<string, OrderCardItem[]>>({});
  const ticketIdsRef = useRef<string[]>([]);

  // Sort + Group controls — operator preference, persisted per device.
  type SortMode = 'time-asc' | 'time-desc' | 'status' | 'service' | 'customer' | 'total';
  type GroupMode = 'none' | 'service' | 'status';
  const SORT_KEYS: SortMode[] = ['time-asc', 'time-desc', 'status', 'service', 'customer', 'total'];
  const GROUP_KEYS: GroupMode[] = ['none', 'service', 'status'];
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const v = window.localStorage.getItem('qflo.queueCanvas.sort');
      return (SORT_KEYS as string[]).includes(v ?? '') ? (v as SortMode) : 'time-asc';
    } catch { return 'time-asc'; }
  });
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    try {
      const v = window.localStorage.getItem('qflo.queueCanvas.group');
      return (GROUP_KEYS as string[]).includes(v ?? '') ? (v as GroupMode) : 'none';
    } catch { return 'none'; }
  });
  const cycleSort = () => {
    const i = SORT_KEYS.indexOf(sortMode);
    const next = SORT_KEYS[(i + 1) % SORT_KEYS.length];
    setSortMode(next);
    try { window.localStorage.setItem('qflo.queueCanvas.sort', next); } catch {}
  };
  const cycleGroup = () => {
    const i = GROUP_KEYS.indexOf(groupMode);
    const next = GROUP_KEYS[(i + 1) % GROUP_KEYS.length];
    setGroupMode(next);
    try { window.localStorage.setItem('qflo.queueCanvas.group', next); } catch {}
  };
  const sortLabel = (m: SortMode): string =>
    m === 'time-asc' ? tl('Oldest first')
    : m === 'time-desc' ? tl('Newest first')
    : m === 'status' ? tl('Status')
    : m === 'service' ? tl('Service')
    : m === 'customer' ? tl('Customer')
    : tl('Total');
  const groupLabel = (m: GroupMode): string =>
    m === 'none' ? tl('No grouping')
    : m === 'service' ? tl('By Service')
    : tl('By Status');

  // Expanded-view modal: clicked card pops up at ~1.6× for easy reading.
  // Closing happens via backdrop, header, footer empty space, or Esc.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedTicket = expandedId ? tickets.find((t) => t.id === expandedId) ?? null : null;
  // Esc key closes the modal.
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setExpandedId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedId]);
  // Auto-close if the underlying ticket disappears (completed, cancelled, etc.)
  useEffect(() => {
    if (expandedId && !expandedTicket) setExpandedId(null);
  }, [expandedId, expandedTicket]);

  const fetchItems = useCallback(async () => {
    const ids = ticketIdsRef.current;
    if (ids.length === 0) { setItemsMap({}); return; }
    try {
      const rows: any[] = await (window as any).qf.ticketItems.listForTickets(ids);
      if (!Array.isArray(rows)) return;
      const map: Record<string, OrderCardItem[]> = {};
      for (const id of ids) map[id] = [];
      for (const r of rows) {
        if (r.ticket_id && map[r.ticket_id]) {
          map[r.ticket_id].push({
            id: r.id,
            ticket_id: r.ticket_id,
            name: r.name ?? '',
            qty: r.qty ?? 1,
            note: r.note ?? null,
            unit_price: r.unit_price ?? null,
            kitchen_status: r.kitchen_status ?? 'new',
          });
        }
      }
      setItemsMap(map);
    } catch (err) {
      console.warn('[QueueOrdersCanvas] fetchItems error', err);
    }
  }, []);

  // Keep the ref in sync with the current ticket list
  useEffect(() => {
    ticketIdsRef.current = tickets.map((t) => t.id);
    fetchItems();
  }, [tickets, fetchItems]);

  // Poll every 4 s
  useEffect(() => {
    const iv = setInterval(fetchItems, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchItems]);

  // Subscribe to IPC ticketItems:changed
  useEffect(() => {
    const unsub = (window as any).qf?.ticketItems?.onChange?.(() => {
      fetchItems();
    });
    return () => { try { unsub?.(); } catch {} };
  }, [fetchItems]);

  // Apply sort + group. We compute on every render — the lists are small
  // (in-flight orders only, rarely > 30) so the cost is negligible.
  const ticketTotal = (tk: Ticket): number => {
    return (itemsMap[tk.id] ?? []).reduce((s, i) => s + (i.unit_price ?? 0) * i.qty, 0);
  };
  const ticketSvcType = (tk: Ticket): 'takeout' | 'delivery' | 'dine_in' | 'other' => {
    return resolveRestaurantServiceType(serviceNames[tk.service_id ?? ''] ?? '');
  };
  const sortedTickets = (() => {
    const arr = [...tickets];
    const byTimeAsc = (a: Ticket, b: Ticket) => {
      const ta = new Date(a.called_at ?? a.created_at ?? 0).getTime();
      const tb = new Date(b.called_at ?? b.created_at ?? 0).getTime();
      return ta - tb;
    };
    if (sortMode === 'time-asc') arr.sort(byTimeAsc);
    else if (sortMode === 'time-desc') arr.sort((a, b) => -byTimeAsc(a, b));
    else if (sortMode === 'status') {
      const order: Record<string, number> = { ready: 0, preparing: 1, mixed: 2, new: 3, none: 4 };
      arr.sort((a, b) => {
        const ag = aggregateKitchenStatus(itemsMap[a.id] ?? []);
        const bg = aggregateKitchenStatus(itemsMap[b.id] ?? []);
        return (order[ag] ?? 99) - (order[bg] ?? 99) || byTimeAsc(a, b);
      });
    } else if (sortMode === 'service') {
      const order: Record<string, number> = { takeout: 0, delivery: 1, dine_in: 2, other: 3 };
      arr.sort((a, b) => order[ticketSvcType(a)] - order[ticketSvcType(b)] || byTimeAsc(a, b));
    } else if (sortMode === 'customer') {
      arr.sort((a, b) => {
        const na = String((a.customer_data as any)?.name ?? '').toLowerCase();
        const nb = String((b.customer_data as any)?.name ?? '').toLowerCase();
        return na.localeCompare(nb) || byTimeAsc(a, b);
      });
    } else if (sortMode === 'total') {
      arr.sort((a, b) => ticketTotal(b) - ticketTotal(a) || byTimeAsc(a, b));
    }
    return arr;
  })();

  type Group = { key: string; label: string; items: Ticket[] };
  const groupedTickets: Group[] = (() => {
    if (groupMode === 'none') return [{ key: 'all', label: '', items: sortedTickets }];
    const map = new Map<string, { key: string; label: string; items: Ticket[]; order: number }>();
    for (const tk of sortedTickets) {
      let key = 'other'; let label = ''; let order = 99;
      if (groupMode === 'service') {
        const t = ticketSvcType(tk);
        key = t;
        label = t === 'takeout' ? tl('Takeout')
          : t === 'delivery' ? tl('Delivery')
          : t === 'dine_in' ? tl('Dine in')
          : tl('Other');
        order = t === 'takeout' ? 0 : t === 'delivery' ? 1 : t === 'dine_in' ? 2 : 3;
      } else if (groupMode === 'status') {
        const ag = aggregateKitchenStatus(itemsMap[tk.id] ?? []);
        key = ag;
        label = ag === 'ready' ? tl('Ready')
          : ag === 'preparing' ? tl('Preparing')
          : ag === 'mixed' ? tl('Mixed')
          : ag === 'new' ? tl('New order')
          : tl('Other');
        order = ag === 'ready' ? 0 : ag === 'preparing' ? 1 : ag === 'mixed' ? 2 : ag === 'new' ? 3 : 4;
      }
      if (!map.has(key)) map.set(key, { key, label, items: [], order });
      map.get(key)!.items.push(tk);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order);
  })();

  if (tickets.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, gap: 16,
      }}>
        <div style={{ fontSize: 40 }}>🛍️</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text2)' }}>
          {tl('No active orders')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', maxWidth: 280 }}>
          {tl('Call a customer to start a takeout or delivery order')}
        </div>
        {waitingCount > 0 && !queuePaused && (
          <button
            onClick={onCallNext}
            style={{
              marginTop: 8, padding: '12px 28px', borderRadius: 10,
              background: 'var(--primary, #3b82f6)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700,
              boxShadow: '0 4px 12px rgba(59,130,246,0.4)',
            }}
          >
            {tl('Call Next ({count})', { count: waitingCount })}
          </button>
        )}
      </div>
    );
  }

  return (
    // Bulletproof scroll containment via absolute positioning.
    // Earlier attempts (flex:1+minHeight:0 chain, then grid-template-rows)
    // both failed because *some* ancestor in the rail chain didn't propagate
    // a bounded height — the scroll region kept growing with content.
    // Using position:relative on this root + position:absolute inset:0 on
    // the scroll body means the scroll body's height is pinned to this
    // root's height regardless of what the rest of the tree is doing.
    <div style={{
      flex: 1,
      minHeight: 0,
      height: '100%',                 // force a definite height for absolute children
      position: 'relative',
      overflow: 'hidden',
      padding: '8px 6px 12px',
      boxSizing: 'border-box',
    }}>
      {/* Header — kept in normal flow at the top of the relative box.
          Holds the title + Sort + Group cycling controls + waiting count.
          Sort/Group preferences persist in localStorage per device. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 12, flexWrap: 'wrap',
        minHeight: 24,
      }}>
        <span style={{
          fontSize: 12, fontWeight: 800, color: 'var(--text3)',
          textTransform: 'uppercase', letterSpacing: 1,
        }}>
          {tl('Active orders ({count})', { count: tickets.length })}
        </span>
        <button
          onClick={cycleSort}
          title={tl('Sort by')}
          aria-label={tl('Sort by')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 14,
            border: '1.5px solid var(--border)',
            background: sortMode === 'time-asc' ? 'transparent' : 'var(--surface2)',
            cursor: 'pointer', fontSize: 11, fontWeight: 700,
            color: sortMode === 'time-asc' ? 'var(--text3)' : 'var(--text)',
            whiteSpace: 'nowrap',
          }}
        >
          {'↕'} {sortLabel(sortMode)}
        </button>
        <button
          onClick={cycleGroup}
          title={tl('Group by')}
          aria-label={tl('Group by')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 14,
            border: '1.5px solid var(--border)',
            background: groupMode === 'none' ? 'transparent' : 'var(--surface2)',
            cursor: 'pointer', fontSize: 11, fontWeight: 700,
            color: groupMode === 'none' ? 'var(--text3)' : 'var(--text)',
            whiteSpace: 'nowrap',
          }}
        >
          {'\u{1F4D1}'} {groupLabel(groupMode)}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginInlineStart: 'auto' }}>
          {tl('{count} waiting', { count: waitingCount })}
        </span>
      </div>

      {/* Card grid — absolute-positioned so its height is bound by the
          relative parent above, NOT by ancestor flex chains. Top offset
          accounts for the header (24px) + its 12px margin + container
          padding-top (8px) = ~44px. */}
      <div style={{
        position: 'absolute',
        top: 44, left: 6, right: 6, bottom: 12,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
        gap: 12,
        alignContent: 'start',
      }}>
        {groupedTickets.flatMap((group) => [
          // Group section header — full-row (gridColumn: 1 / -1) so it
          // never sits awkwardly in a single grid cell.
          ...(group.label ? [(
            <div
              key={`group-${group.key}`}
              style={{
                gridColumn: '1 / -1',
                fontSize: 11, fontWeight: 800, color: 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: 1,
                padding: '4px 4px 0',
                borderTop: '1px solid var(--border)',
                marginTop: 4,
              }}
            >
              {group.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>· {group.items.length}</span>
            </div>
          )] : []),
          ...group.items.map((ticket) => {
            const svcName = serviceNames[ticket.service_id ?? ''] ?? '';
            const cardItems = itemsMap[ticket.id] ?? [];
            return (
              <QueueOrderCard
                key={ticket.id}
                ticket={ticket}
                items={cardItems}
                isActive={ticket.id === activeTicketId}
                locale={locale}
                serviceName={svcName}
                currency={currency}
                decimals={decimals}
                onFocus={(id) => { onFocus(id); setExpandedId(id); }}
                onPark={onPark}
                onResume={onResume}
                onRecall={onRecall}
                onAddItems={onAddItems}
                onCall={onCall}
                onStartServing={onStartServing}
                onComplete={onComplete}
                onNoShow={onNoShow}
                onCancel={onCancel}
                onBan={onBan}
                onTransfer={onTransfer}
                onRequeue={onRequeue}
                onItemNote={onItemNote}
                onAcceptOrder={onAcceptOrder}
                onDeclineOrder={onDeclineOrder}
                suggestedEtaMinutes={suggestedEtaMinutesByTicket?.[ticket.id]}
                onDispatchOrder={onDispatchOrder}
                onArriveOrder={onArriveOrder}
                onDeliverOrder={onDeliverOrder}
                riderLink={riderLinks?.[ticket.id] ?? null}
                onCopyRiderLink={onCopyRiderLink}
                availableRiders={availableRiders}
                onAssignRider={onAssignRider}
                assignedRider={(() => {
                  const rid = (ticket as any).assigned_rider_id;
                  if (!rid || !availableRiders) return null;
                  const r = availableRiders.find((x) => x.id === rid);
                  return r ? { id: r.id, name: r.name, phone: r.phone } : null;
                })()}
              />
            );
          }),
        ])}
      </div>

      {/* Sticky Call Next button */}
      {!queuePaused && (
        <div style={{
          position: 'absolute', bottom: 16, insetInlineEnd: 16,
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={onCallNext}
            disabled={waitingCount === 0}
            style={{
              padding: '12px 22px', borderRadius: 12,
              background: waitingCount > 0 ? 'var(--primary, #3b82f6)' : 'var(--surface2)',
              color: waitingCount > 0 ? '#fff' : 'var(--text3)',
              border: 'none', cursor: waitingCount > 0 ? 'pointer' : 'default',
              fontSize: 14, fontWeight: 700,
              boxShadow: waitingCount > 0 ? '0 4px 16px rgba(59,130,246,0.4)' : 'none',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all 0.2s',
            }}
          >
            <span style={{ fontSize: 16 }}>📲</span>
            {tl('Call Next ({count})', { count: waitingCount })}
          </button>
        </div>
      )}

      {/* Expanded ticket modal */}
      {expandedTicket && (
        <ExpandedTicketModal
          ticket={expandedTicket}
          items={itemsMap[expandedTicket.id] ?? []}
          locale={locale}
          serviceName={serviceNames[expandedTicket.service_id ?? ''] ?? ''}
          currency={currency}
          decimals={decimals}
          onClose={() => setExpandedId(null)}
          onPark={(id) => { onPark(id); setExpandedId(null); }}
          onResume={(id) => { onResume(id); setExpandedId(null); }}
          onRecall={(id) => { onRecall(id); }}
          onAddItems={(t) => { onAddItems(t); setExpandedId(null); }}
          onCall={(id) => { onCall(id); }}
          onStartServing={(id) => { onStartServing(id); }}
          onComplete={(id) => { onComplete(id); setExpandedId(null); }}
          onNoShow={(id) => { onNoShow(id); setExpandedId(null); }}
          onCancel={(id) => { onCancel(id); setExpandedId(null); }}
          onTransfer={(id) => { onTransfer(id); setExpandedId(null); }}
          onRequeue={(id) => { onRequeue(id); setExpandedId(null); }}
          onBan={(id) => { onBan(id); setExpandedId(null); }}
          onItemNote={onItemNote}
          onDispatchOrder={onDispatchOrder ? (id) => { onDispatchOrder(id); } : undefined}
          onArriveOrder={onArriveOrder ? (id) => { onArriveOrder(id); } : undefined}
          onDeliverOrder={onDeliverOrder ? (id) => { onDeliverOrder(id); setExpandedId(null); } : undefined}
          availableRiders={availableRiders}
          onAssignRider={onAssignRider}
          assignedRider={(() => {
            const rid = (expandedTicket as any).assigned_rider_id;
            if (!rid || !availableRiders) return null;
            const r = availableRiders.find((x) => x.id === rid);
            return r ? { id: r.id, name: r.name, phone: r.phone } : null;
          })()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded ticket modal — opens when a card is clicked. Larger fonts for
// reading at distance. Closes on backdrop click, header click, footer empty
// space click, or Esc. Action buttons inside stop propagation so they
// don't accidentally close before firing.
// ---------------------------------------------------------------------------
interface ExpandedTicketModalProps {
  ticket: Ticket;
  items: OrderCardItem[];
  locale: DesktopLocale;
  serviceName: string;
  currency: string;
  decimals: number;
  onClose: () => void;
  onPark: (id: string) => void;
  onResume: (id: string) => void;
  onRecall: (id: string) => void;
  onAddItems: (t: Ticket) => void;
  onCall: (id: string) => void;
  onStartServing: (id: string) => void;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void;
  onCancel: (id: string) => void;
  onTransfer: (id: string) => void;
  onRequeue: (id: string) => void;
  onBan: (id: string) => void;
  onItemNote: (itemId: string, note: string) => void;
  /** Delivery transitions, optional. Surfaced only on serving delivery
   *  cards; for other service types we keep the plain Complete button. */
  onDispatchOrder?: (id: string) => void;
  onArriveOrder?: (id: string) => void;
  onDeliverOrder?: (id: string) => void;
  // In-house rider assignment — same contract as QueueOrderCard so
  // the enlarged view uses the identical Assign / Awaiting / Out-for-
  // delivery affordances and hits /api/orders/assign just like the
  // small card. Sentinel rider id `__unassign` clears the assignment.
  availableRiders?: Array<{ id: string; name: string; phone: string; last_seen_at: string | null }>;
  onAssignRider?: (ticketId: string, riderId: string) => void;
  assignedRider?: { id: string; name: string; phone: string } | null;
}

function ExpandedTicketModal({
  ticket, items, locale, serviceName, currency, decimals,
  onClose, onPark, onResume, onRecall, onAddItems, onCall, onStartServing, onComplete,
  onNoShow, onCancel, onTransfer, onRequeue, onBan, onItemNote,
  onDispatchOrder, onArriveOrder, onDeliverOrder,
  availableRiders, onAssignRider, assignedRider,
}: ExpandedTicketModalProps) {
  const tl = (key: string, values?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, values);
  const [showOverflow, setShowOverflow] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const aggStatus = aggregateKitchenStatus(items);

  const isParked = ticket.status === 'waiting' && !!ticket.parked_at;
  const isWaiting = ticket.status === 'waiting' && !ticket.parked_at;
  const isCalled = ticket.status === 'called';
  const isServing = ticket.status === 'serving';

  const svcType = resolveRestaurantServiceType(serviceName);
  const showSvcPill = shouldShowServicePill(svcType);
  const svcVisuals = showSvcPill ? RESTAURANT_SERVICE_VISUALS[svcType] : null;
  const svcLabel = svcType === 'takeout' ? tl('Takeout')
    : svcType === 'delivery' ? tl('Delivery')
    : svcType === 'dine_in' ? tl('Dine in')
    : '';

  const statusLabel = isParked ? tl('Parked')
    : isCalled ? tl('CALLING')
    : isServing ? tl('NOW SERVING')
    : ticket.status;
  const statusColor = isParked ? 'var(--text3)'
    : isCalled ? '#3b82f6'
    : isServing ? '#22c55e'
    : 'var(--text3)';

  const customerData = ticket.customer_data as Record<string, any> | null | undefined;
  const customerName = customerData?.name || customerData?.customer_name || tl('Walk-in Customer');
  const customerPhone = customerData?.phone || customerData?.customer_phone || null;

  const total = items.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.qty, 0);
  const itemCount = items.reduce((sum, i) => sum + i.qty, 0);

  const fmtMoney = (amount: number) => `${currency}${amount.toFixed(decimals)}`;

  // Stop propagation on the inner card so backdrop-click only fires when
  // the operator actually clicks the dimmed area outside.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${ticket.ticket_number} — ${customerName}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={stop}
        style={{
          background: 'var(--surface)',
          border: `2px solid ${isCalled ? '#3b82f6' : isServing ? '#22c55e' : 'var(--border)'}`,
          borderRadius: 16,
          width: '100%', maxWidth: 760, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header — clickable to close (no buttons here) */}
        <div
          onClick={onClose}
          style={{
            padding: '20px 28px 16px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
          title={tl('Click to close')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 38, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: 'var(--text)', letterSpacing: -0.5, lineHeight: 1,
            }}>
              {ticket.ticket_number}
            </span>
            {svcVisuals && svcLabel && (
              <span style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 15,
                fontWeight: aggStatus === 'ready' ? 800 : 700,
                background: aggStatus === 'ready' ? 'var(--success, #22c55e)' : 'var(--surface2)',
                color: aggStatus === 'ready' ? '#fff' : 'var(--text2)',
                border: aggStatus === 'ready'
                  ? '1px solid var(--success, #22c55e)'
                  : '1px solid var(--border)',
                transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
              }}>
                {svcType === 'takeout' ? '🛍️' : svcType === 'delivery' ? '🚲' : ''} {svcLabel}
              </span>
            )}
            {!isServing && (
              <span style={{
                padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 800,
                background: statusColor + '22', color: statusColor,
                border: `1px solid ${statusColor}55`,
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>
                {statusLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 18 }}>
            <span style={{ fontWeight: 700, color: 'var(--text)' }} dir="auto">
              {customerName}
            </span>
            {customerPhone && (
              <a
                href={`tel:${customerPhone}`}
                onClick={stop}
                style={{
                  fontSize: 16, color: 'var(--primary, #3b82f6)',
                  textDecoration: 'none', direction: 'ltr',
                }}
              >
                {customerPhone}
              </a>
            )}
          </div>

          {/* Delivery address + Maps link in the expanded modal — same
              data the smaller card surfaces, larger and easier to read.
              When lat/lng are present (customer shared a WA pin) the
              "Open in Maps" pill is one tap to launch directions on the
              operator's device. Out-for-delivery state shown as a pill. */}
          {svcType === 'delivery' && (() => {
            const da = (() => {
              const raw = (ticket as any).delivery_address;
              if (!raw) return null;
              if (typeof raw === 'object') return raw as Record<string, any>;
              try { return JSON.parse(raw) as Record<string, any>; } catch { return null; }
            })();
            const isDispatched = Boolean((ticket as any).dispatched_at);
            if (!da?.street && !(da?.lat && da?.lng) && !isDispatched) return null;
            const lat = typeof da?.lat === 'number' ? da.lat : null;
            const lng = typeof da?.lng === 'number' ? da.lng : null;
            const hasPin = lat != null && lng != null;
            const mapsHref = hasPin
              ? `https://www.google.com/maps/?q=${encodeURIComponent(`${lat},${lng}`)}`
              : null;
            return (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {da?.street && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    fontSize: 14, color: 'var(--text2)',
                    padding: '10px 14px', borderRadius: 10,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 18 }}>📍</span>
                    <div style={{ flex: 1, lineHeight: 1.45, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }} dir="auto">
                        {da.street}
                      </div>
                      {da.city && <div>{da.city}</div>}
                      {/* See QueueOrderCard for why we surface "approximate"
                          when a pin is attached — Nominatim's house-number
                          mapping isn't reliable enough to trust as a
                          navigation target. The pin always is. */}
                      {hasPin && (
                        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--text3, #94a3b8)', fontStyle: 'italic' }}>
                          {tl('Address approximate — use pin')}
                        </div>
                      )}
                      {da.instructions && (
                        <div style={{ marginTop: 3, fontStyle: 'italic' }}>{da.instructions}</div>
                      )}
                      {mapsHref && (
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noreferrer"
                          onClick={stop}
                          style={{
                            display: 'inline-block', marginTop: 10,
                            padding: '8px 18px', borderRadius: 8,
                            fontSize: 14, fontWeight: 700,
                            background: '#3b82f6', color: '#fff',
                            border: '1px solid #2563eb',
                            textDecoration: 'none',
                          }}
                        >
                          📍 {tl('Go to pin')}
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {isDispatched && (
                  <div style={{
                    display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 6,
                    padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    background: 'rgba(245,158,11,0.18)', color: '#f59e0b',
                    border: '1px solid rgba(245,158,11,0.4)',
                  }}>
                    🛵 {tl('Out for delivery')}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Items — scrolls if long */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '18px 28px',
        }}>
          {items.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 0',
              fontSize: 16, color: 'var(--text3)',
            }}>
              {tl('No items yet')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((item) => {
                // Mirror QueueOrderCard exactly so served items look served,
                // in-progress items glow amber, ready items go bold-white,
                // and new items stay subdued. Operators have already learned
                // these colors on the small card; the modal must repeat them
                // verbatim or it stops being a "zoomed-in" view.
                const isDone = item.kitchen_status === 'served';
                const isReady = item.kitchen_status === 'ready';
                const isPrep = item.kitchen_status === 'in_progress';
                const itemColor = isDone ? 'var(--text3)'
                  : isReady ? 'var(--text)'
                  : isPrep ? 'var(--warning, #f59e0b)'
                  : 'var(--text3)';
                const itemWeight: 400 | 600 | 700 = isReady ? 700 : isPrep ? 600 : 400;
                const hasNote = !!(item.note && item.note.trim());
                const isEditingNote = editingNoteId === item.id;

                return (
                  <div key={item.id}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      fontSize: 18, color: itemColor, fontWeight: itemWeight,
                      textDecoration: isDone ? 'line-through' : 'none',
                      lineHeight: 1.4,
                      transition: 'color 0.2s ease, font-weight 0.2s ease',
                    }}>
                      <span style={{
                        fontWeight: 800, minWidth: 36, textAlign: 'start',
                        direction: 'ltr', color: itemColor, fontSize: 18,
                      }}>
                        {item.qty}×
                      </span>
                      <span style={{ flex: 1 }} dir="auto">{item.name}</span>

                      {/* Note indicator button — same as small card */}
                      <button
                        onClick={() => setEditingNoteId(isEditingNote ? null : item.id)}
                        title={tl('Kitchen note')}
                        style={{
                          padding: '3px 9px', borderRadius: 6, fontSize: 14,
                          border: `1px solid ${hasNote ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                          background: hasNote ? 'rgba(245,158,11,0.15)' : 'transparent',
                          color: hasNote ? 'var(--warning, #f59e0b)' : 'var(--text3)',
                          cursor: 'pointer', lineHeight: 1, flexShrink: 0,
                        }}
                        aria-label={tl('Kitchen note')}
                      >
                        💬
                      </button>

                      {(item.unit_price ?? 0) > 0 && (
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>
                          {fmtMoney((item.unit_price ?? 0) * item.qty)}
                        </span>
                      )}
                    </div>

                    {item.note && !isEditingNote && (
                      <div style={{
                        marginInlineStart: 48, marginTop: 2,
                        fontSize: 14, color: 'var(--warning, #f59e0b)',
                        fontStyle: 'italic', lineHeight: 1.4,
                      }} dir="auto">
                        {item.note}
                      </div>
                    )}

                    {isEditingNote && (
                      <ItemNoteEditor
                        item={item}
                        locale={locale}
                        onSave={(note) => { onItemNote(item.id, note); setEditingNoteId(null); }}
                        onClose={() => setEditingNoteId(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Total bar — item count, aggregate kitchen status pill, and total */}
        {items.length > 0 && (
          <div style={{
            padding: '12px 28px',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 16,
          }}>
            <span style={{ color: 'var(--text3)', fontWeight: 600 }}>
              {itemCount} {tl('items')}
            </span>
            {/* Aggregate-status pill removed — service-type badge in
                the header now turns green when ready. */}
            {total > 0 && (
              <span style={{
                marginInlineStart: 'auto',
                fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: 'var(--text)', fontSize: 20,
              }}>
                {fmtMoney(total)}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div
          onClick={stop}
          style={{
            padding: '16px 28px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface2)',
            display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          }}
        >
          {isParked && (
            <button onClick={() => onResume(ticket.id)} style={modalBtnStyle('var(--primary, #3b82f6)')}>
              {tl('Resume')}
            </button>
          )}
          {isWaiting && (
            <>
              <button onClick={() => onCall(ticket.id)} style={modalBtnStyle('var(--primary, #3b82f6)', true)}>
                {tl('Call')}
              </button>
              <button onClick={() => onStartServing(ticket.id)} style={modalBtnStyle('var(--success, #22c55e)', true)}>
                {tl('Serve')}
              </button>
            </>
          )}
          {/* Serve hidden for restaurant verticals — kitchen-prep starts
              automatically. Other queues still need the manual Serve. */}
          {isCalled && svcType !== 'dine_in' && svcType !== 'takeout' && svcType !== 'delivery' && (
            <button onClick={() => onStartServing(ticket.id)} style={modalBtnStyle('var(--success, #22c55e)', true)}>
              {tl('Serve')}
            </button>
          )}
          {isServing && (() => {
            // Delivery cards: identical contract to QueueOrderCard.
            //   stage 1, no rider           → 🛵 Assign rider… (or + Add a driver)
            //   stage 1, rider assigned      → ⏳ Awaiting <name> + Reassign / Unassign
            //   stage 2, dispatched          → 🛵 Out for delivery — <name> + Arrived/Delivered + Unassign
            //   stage 2, arrived             → Delivered + Unassign
            // All transitions go through /api/orders/assign (assign /
            // unassign / reassign) or /api/orders/{arrived,delivered}.
            // The Dispatch button is gone — rider ACCEPT in WA is what
            // flips dispatched_at.
            const isDeliveryTicket = svcType === 'delivery';
            const isDispatched = Boolean((ticket as any).dispatched_at);
            const isArrived = Boolean((ticket as any).arrived_at);
            const isAssignedToRider = Boolean((ticket as any).assigned_rider_id);

            if (isDeliveryTicket && (onAssignRider || onDispatchOrder || onDeliverOrder)) {
              // STAGE 1 — no rider yet, kitchen done.
              if (!isDispatched && !isAssignedToRider) {
                if (onAssignRider && availableRiders && availableRiders.length > 0) {
                  // Outlined orange — matches the enlarged-card aesthetic
                  // (transparent fill, orange ring, orange text, native
                  // chevron). The native <select> wrapper renders the
                  // chevron; we only style the trigger.
                  return (
                    <select
                      defaultValue=""
                      onChange={(e) => { const rid = e.target.value; if (rid) onAssignRider(ticket.id, rid); }}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 12,
                        background: 'rgba(245,158,11,0.08)',
                        color: '#f59e0b',
                        border: '2px solid rgba(245,158,11,0.7)',
                        fontWeight: 800,
                        fontSize: 17,
                        cursor: 'pointer',
                        appearance: 'auto',
                        colorScheme: 'light dark' as any,
                      }}
                    >
                      <option value="" disabled hidden>🛵 {tl('Assign rider')}…</option>
                      {availableRiders.map((r) => (
                        <option key={r.id} value={r.id} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                          {r.name}{r.last_seen_at && (Date.now() - new Date(r.last_seen_at).getTime() < 24 * 60 * 60 * 1000)
                            ? '  ✓ online'
                            : '  ⚠ may be offline'}
                        </option>
                      ))}
                    </select>
                  );
                }
                if (onAssignRider) {
                  return (
                    <button
                      onClick={() => {
                        const evt = new CustomEvent('qf:open-business-admin', { detail: { tab: 'riders' } });
                        window.dispatchEvent(evt);
                      }}
                      style={{
                        ...modalBtnStyle('#f59e0b', false),
                        background: 'transparent',
                        border: '1px dashed rgba(245,158,11,0.5)',
                        color: '#f59e0b',
                      }}
                    >
                      🛵 + {tl('Add a driver to assign this order')}
                    </button>
                  );
                }
                // No assign handler at all — fall back to legacy Dispatch.
                return onDispatchOrder ? (
                  <button onClick={() => onDispatchOrder(ticket.id)} style={modalBtnStyle('#f59e0b', true)}>
                    🛵 {tl('Dispatch')}
                  </button>
                ) : null;
              }

              // STAGE 1 — rider assigned, awaiting ACCEPT.
              if (!isDispatched && isAssignedToRider) {
                return (
                  <>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(245,158,11,0.10)',
                      border: '1px solid rgba(245,158,11,0.4)',
                      color: '#f59e0b', fontSize: 14, fontWeight: 700,
                    }}>
                      ⏳ {tl('Pending')} — {assignedRider?.name ?? tl('rider')}
                    </div>
                    {onAssignRider && availableRiders && availableRiders.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={(e) => { const rid = e.target.value; if (rid) onAssignRider(ticket.id, rid); }}
                        style={{
                          ...modalBtnStyle('var(--text2)', false),
                          padding: '10px 12px', appearance: 'auto',
                          colorScheme: 'light dark' as any,
                        }}
                      >
                        <option value="" disabled hidden>{tl('Reassign')}…</option>
                        {availableRiders.filter((r) => r.id !== assignedRider?.id).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                    {onAssignRider && (
                      <button
                        onClick={() => onAssignRider(ticket.id, '__unassign')}
                        title={tl('Cancel assignment — rider has not accepted yet')}
                        style={{
                          ...modalBtnStyle('#ef4444', false),
                          background: 'transparent',
                          border: '1px solid rgba(239,68,68,0.5)',
                          color: '#ef4444',
                        }}
                      >
                        ✕ {tl('Cancel')}
                      </button>
                    )}
                  </>
                );
              }

              // STAGE 2 — dispatched (rider accepted). Show Arrived /
              // Delivered + Unassign so the operator can pull the order
              // back if the rider goes silent.
              return (
                <>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.10)',
                    border: '1px solid rgba(245,158,11,0.4)',
                    color: '#f59e0b', fontSize: 14, fontWeight: 700,
                  }}>
                    🛵 {tl('Out for delivery')}{assignedRider?.name ? ` — ${assignedRider.name}` : ''}
                  </div>
                  {!isArrived && onArriveOrder && (
                    <button onClick={() => onArriveOrder(ticket.id)} style={modalBtnStyle('#3b82f6', true)}>
                      🚪 {tl('Arrived')}
                    </button>
                  )}
                  {onDeliverOrder && (
                    <button onClick={() => onDeliverOrder(ticket.id)} style={modalBtnStyle('var(--success, #22c55e)', true)}>
                      ✓ {tl('Delivered')}
                    </button>
                  )}
                  {onAssignRider && (
                    <button
                      onClick={() => onAssignRider(ticket.id, '__unassign')}
                      style={{
                        ...modalBtnStyle('#ef4444', false),
                        background: 'transparent',
                        border: '1px solid rgba(239,68,68,0.5)',
                        color: '#ef4444',
                      }}
                      title={tl('Pull this order back from the rider')}
                    >
                      ✕ {tl('Unassign')}
                    </button>
                  )}
                </>
              );
            }
            return (
              <button onClick={() => onComplete(ticket.id)} style={modalBtnStyle('var(--success, #22c55e)', true)}>
                {tl('Complete')}
              </button>
            );
          })()}
          {isServing && (
            <button onClick={() => onAddItems(ticket)} style={modalBtnStyle('var(--primary, #3b82f6)', true)}>
              + {tl('Add items')}
            </button>
          )}
          {(isParked || isCalled) && (
            <button onClick={() => onRecall(ticket.id)} style={modalBtnStyle('var(--text2)', true)}>
              {tl('Recall')} {ticket.recall_count > 0 ? `(${ticket.recall_count})` : ''}
            </button>
          )}

          <div style={{ position: 'relative', marginInlineStart: 'auto' }}>
            <button
              onClick={() => setShowOverflow((v) => !v)}
              style={{
                padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text2)',
                cursor: 'pointer', fontSize: 18, lineHeight: 1, fontWeight: 700,
              }}
              aria-label={tl('More actions')}
              aria-expanded={showOverflow}
            >
              ···
            </button>
            {showOverflow && (
              <div
                role="menu"
                style={{
                  position: 'absolute', bottom: '100%', insetInlineEnd: 0,
                  marginBottom: 6, background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  padding: '6px 0', boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
                  minWidth: 180, zIndex: 5,
                }}
              >
                {(isCalled || isServing) && (
                  <ModalOverflowItem label={tl('Park')} color="var(--text2)" onClick={() => { setShowOverflow(false); onPark(ticket.id); }} />
                )}
                {!isCalled && !isServing && (
                  <ModalOverflowItem label={tl('No Show')} color="var(--warning, #f59e0b)" onClick={() => { setShowOverflow(false); onNoShow(ticket.id); }} />
                )}
                <ModalOverflowItem label={tl('Back to Queue')} color="var(--text2)" onClick={() => { setShowOverflow(false); onRequeue(ticket.id); }} />
                <ModalOverflowItem label={tl('Transfer')} color="var(--text2)" onClick={() => { setShowOverflow(false); onTransfer(ticket.id); }} />
                <ModalOverflowItem label={tl('Cancel')} color="var(--danger, #ef4444)" onClick={() => { setShowOverflow(false); onCancel(ticket.id); }} />
                <ModalOverflowItem label={tl('Ban')} color="var(--danger, #ef4444)" onClick={() => { setShowOverflow(false); onBan(ticket.id); }} />
              </div>
            )}
          </div>
        </div>

        {/* Footer empty band — click closes (gives a "tap-out" target below buttons) */}
        <div
          onClick={onClose}
          style={{
            height: 32, cursor: 'pointer',
            background: 'var(--surface)',
          }}
          title={tl('Click to close')}
          aria-label={tl('Close')}
        />
      </div>
    </div>
  );
}

function modalBtnStyle(color: string, outline = false): React.CSSProperties {
  return {
    padding: '10px 18px', borderRadius: 9, cursor: 'pointer',
    fontSize: 15, fontWeight: 800, lineHeight: 1.2,
    border: outline ? `1px solid ${color}55` : 'none',
    background: outline ? `${color}15` : color,
    color: outline ? color : '#fff',
    transition: 'opacity 0.15s',
  };
}

function ModalOverflowItem({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'start',
        padding: '11px 18px', border: 'none', background: 'transparent',
        cursor: 'pointer', fontSize: 14, fontWeight: 600, color,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}
