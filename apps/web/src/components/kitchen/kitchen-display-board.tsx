'use client';

/**
 * KitchenDisplayBoard — web port of apps/desktop/src/components/KitchenDisplay.tsx
 *
 * Visual parity contract: same filter chips (All / New / Preparing / Ready),
 * same card layout, same age coloring thresholds (green < 5 min, amber < 10 min,
 * red >= 10 min), same click-to-advance per item (new → in_progress → ready,
 * ready → in_progress to un-bump), same "Mark all ready" / "Mark all served"
 * card-level bulk actions, same aggregate status pill in the card header.
 *
 * Styling: Tailwind utility classes + CSS vars (--bg, --surface, --text,
 * --border, --surface2) instead of Station's inline styles. Both light and
 * dark themes are supported via Tailwind's dark: variant and CSS var fallbacks.
 * RTL-safe: logical CSS properties (ms-*, me-*, text-start, border-s, etc.).
 *
 * Realtime: subscribes to a Supabase postgres_changes channel on ticket_items
 * and tickets tables filtered by organization_id (ticket_items has no office_id
 * column — see blocker note in KDS task spec). Reloads full state on any event.
 * Also polls every 8 s as a backup for missed events.
 *
 * Audio alerts: intentionally omitted. The web KDS is mounted on kitchen tablets
 * where noise levels make audio alerts impractical. Operators rely on the visual
 * age-color urgency system. Audio can be added as a future opt-in setting.
 *
 * Full-screen mode: the <html> element is made full-height via globals.css;
 * the layout takes up the full viewport. Operators can use the browser's native
 * F11 / "Add to Home Screen" for true kiosk mode — no custom fullscreen API
 * needed since this is a permanently-mounted display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types (exported so the page can build the initial data on the server)
// ---------------------------------------------------------------------------
export interface KitchenItem {
  id: string;
  ticket_id: string;
  organization_id: string;
  name: string;
  qty: number;
  note: string | null;
  added_at: string;
  kitchen_status: 'new' | 'in_progress' | 'ready' | 'served';
  kitchen_status_at: string | null;
}

export interface KitchenTicket {
  ticket_id: string;
  ticket_number: string;
  table_label: string | null;
  party_size: number | string | null;
  customer_name: string | null;
  ticket_status: string;
  oldest_item_at: string;
  /** Free-text service name joined from the services table. Used to derive
   *  the service-type pill (Takeout / Delivery) on KDS cards. */
  service_name?: string | null;
  items: KitchenItem[];
}

type FilterMode = 'all' | 'new' | 'in_progress' | 'ready';

// ---------------------------------------------------------------------------
// i18n labels — FR / AR / EN (copied verbatim from Station KitchenDisplay.tsx)
// ---------------------------------------------------------------------------
const LABELS = {
  en: {
    filterAll: 'All',
    filterNew: 'New',
    filterCooking: 'Preparing',
    filterReady: 'Ready',
    allClear: 'All caught up',
    noOrders: 'No active orders right now.',
    markAllReady: 'Mark all ready',
    markAllServed: 'Mark all served',
    partyOf: (n: number | string) => `Party of ${n}`,
    statusNew: 'New',
    statusCooking: 'Preparing',
    statusReady: 'Ready',
    loading: 'Loading...',
    partial: 'Partial',
    svcTakeout: 'Takeout',
    svcDelivery: 'Delivery',
    sortByLabel: 'Sort',
    groupByLabel: 'Group',
    sortOldest: 'Oldest',
    sortNewest: 'Newest',
    sortStatus: 'Status',
    sortTable: 'Table / #',
    sortItems: 'Items',
    groupNone: 'No grouping',
    groupStatus: 'By Status',
    groupTable: 'By Table',
  },
  fr: {
    filterAll: 'Tout',
    filterNew: 'Nouveau',
    filterCooking: 'En préparation',
    filterReady: 'Prêt',
    allClear: 'Tout est servi',
    noOrders: 'Aucune commande active en ce moment.',
    markAllReady: 'Tout marquer prêt',
    markAllServed: 'Tout marquer servi',
    partyOf: (n: number | string) => `Table de ${n}`,
    statusNew: 'Nouveau',
    statusCooking: 'En préparation',
    statusReady: 'Prêt',
    loading: 'Chargement...',
    partial: 'Partiel',
    svcTakeout: 'À emporter',
    svcDelivery: 'Livraison',
    sortByLabel: 'Tri',
    groupByLabel: 'Groupe',
    sortOldest: 'Plus ancien',
    sortNewest: 'Plus récent',
    sortStatus: 'Statut',
    sortTable: 'Table / #',
    sortItems: 'Articles',
    groupNone: 'Aucun groupe',
    groupStatus: 'Par statut',
    groupTable: 'Par table',
  },
  ar: {
    filterAll: 'الكل',
    filterNew: 'جديد',
    filterCooking: 'قيد التحضير',
    filterReady: 'جاهز',
    allClear: 'كل الطلبات منجزة',
    noOrders: 'لا توجد طلبات نشطة الآن.',
    markAllReady: 'تحديد الكل جاهزًا',
    markAllServed: 'تحديد الكل مُقدَّمًا',
    partyOf: (n: number | string) => `طاولة ${n}`,
    statusNew: 'جديد',
    statusCooking: 'قيد التحضير',
    statusReady: 'جاهز',
    loading: 'جارٍ التحميل...',
    partial: 'جزئي',
    svcTakeout: 'سفري',
    svcDelivery: 'توصيل',
    sortByLabel: 'ترتيب',
    groupByLabel: 'تجميع',
    sortOldest: 'الأقدم',
    sortNewest: 'الأحدث',
    sortStatus: 'الحالة',
    sortTable: 'الطاولة / #',
    sortItems: 'الأصناف',
    groupNone: 'بدون تجميع',
    groupStatus: 'حسب الحالة',
    groupTable: 'حسب الطاولة',
  },
} as const;
type LocaleKey = keyof typeof LABELS;

// ---------------------------------------------------------------------------
// Service-type resolver
// SHARED-COPY: keep in sync with packages/shared/src/restaurant-services.ts
// ---------------------------------------------------------------------------
type RestaurantServiceType = 'takeout' | 'delivery' | 'dine_in' | 'other';
const TAKEOUT_RE  = /take.?out|à emporter|emporter|takeaway/i;
const DELIVERY_RE = /deliver|livrais/i;

function resolveServiceType(name: string | null | undefined): RestaurantServiceType {
  if (!name) return 'other';
  const lower = name.toLowerCase();
  if (TAKEOUT_RE.test(lower))  return 'takeout';
  if (DELIVERY_RE.test(lower)) return 'delivery';
  return 'other'; // dine-in and other → suppress pill on web KDS
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ageMinutes(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / 60_000);
}

function formatAge(min: number): string {
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? `${min % 60}m` : ''}`;
}

/** Tailwind class for the age-urgency border color (same thresholds as Station). */
function urgencyBorderClass(min: number): string {
  if (min < 5) return 'border-green-500';
  if (min < 10) return 'border-amber-500';
  return 'border-red-500';
}

/** Inline color value for backgrounds/badges that need a dynamic color. */
function urgencyColor(min: number): string {
  if (min < 5) return '#22c55e';
  if (min < 10) return '#f59e0b';
  return '#ef4444';
}

// ---------------------------------------------------------------------------
// KitchenItemRow
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: KitchenItem;
  isNew: boolean;
  busy: boolean;
  L: (typeof LABELS)[LocaleKey];
  onAdvance: (item: KitchenItem) => void;
}

function KitchenItemRow({ item, isNew, busy, L, onAdvance }: ItemRowProps) {
  const status = item.kitchen_status ?? 'new';
  const isReady = status === 'ready';

  const statusLabel =
    status === 'ready' ? L.statusReady
      : status === 'in_progress' ? L.statusCooking
      : L.statusNew;

  // Status pill colors — match Station's CSS var values
  const pillColorClass =
    status === 'ready' ? 'bg-green-500/15 border-green-500/40 text-green-600 dark:text-green-400'
      : status === 'in_progress' ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
      : 'bg-slate-400/15 border-slate-400/40 text-slate-500 dark:text-slate-400';
  const dotColorClass =
    status === 'ready' ? 'bg-green-500'
      : status === 'in_progress' ? 'bg-amber-500'
      : 'bg-slate-400';

  const rowBg = isNew ? 'bg-amber-500/10' : 'hover:bg-[var(--surface2,rgba(148,163,184,0.08))]';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.name} — ${statusLabel}`}
      onClick={() => !busy && onAdvance(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!busy) onAdvance(item);
        }
      }}
      className={`flex items-center gap-2.5 px-1.5 py-2 rounded-md cursor-pointer outline-none transition-colors ${rowBg} ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      {/* Qty badge */}
      <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-blue-500/12">
        <span className="text-sm font-black text-blue-500">&times;{item.qty}</span>
      </div>

      {/* Name + note */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-bold truncate ${
            isReady
              ? 'line-through text-[var(--text3,#64748b)]'
              : 'text-[var(--text,inherit)]'
          }`}
        >
          {item.name}
        </div>
        {item.note ? (
          <div className="text-[11px] text-amber-500 italic mt-px">{item.note}</div>
        ) : null}
      </div>

      {/* Status pill */}
      <div className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-extrabold ${pillColorClass}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`} />
        {statusLabel}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KitchenTicketCard
// ---------------------------------------------------------------------------
interface CardProps {
  card: KitchenTicket;
  newItemIds: Set<string>;
  busy: boolean;
  L: (typeof LABELS)[LocaleKey];
  screenToken: string;
  onItemAdvance: (item: KitchenItem) => void;
  onBumpAllReady: (card: KitchenTicket) => void;
  onMarkAllServed: (card: KitchenTicket) => void;
}

function KitchenTicketCard({
  card, newItemIds, busy, L, screenToken,
  onItemAdvance, onBumpAllReady, onMarkAllServed,
}: CardProps) {
  // Tick every 30 s so age badges stay accurate without a full refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const svcType = resolveServiceType(card.service_name);
  const svcPill =
    svcType === 'takeout'
      ? { color: '#f59e0b', emoji: '🛍️', label: L.svcTakeout }
      : svcType === 'delivery'
        ? { color: '#8b5cf6', emoji: '🚴', label: L.svcDelivery }
        : null;

  const minutes = ageMinutes(card.oldest_item_at);
  const color = urgencyColor(minutes);
  const borderClass = urgencyBorderClass(minutes);

  const allReady = card.items.every((it) => it.kitchen_status === 'ready');
  const headerLabel = card.table_label ?? `#${card.ticket_number}`;

  // Aggregate status — same logic as Station
  const aggregate: 'new' | 'in_progress' | 'ready' | 'mixed' = (() => {
    if (!card.items.length) return 'new';
    const set = new Set(card.items.map((it) => it.kitchen_status));
    if (set.size === 1) return Array.from(set)[0] as 'new' | 'in_progress' | 'ready';
    return 'mixed';
  })();

  const aggLabel =
    aggregate === 'ready' ? L.statusReady
      : aggregate === 'in_progress' ? L.statusCooking
      : aggregate === 'mixed' ? L.partial
      : L.statusNew;

  const aggColorClass =
    aggregate === 'ready' ? 'bg-green-500/18 border-green-500/50 text-green-600 dark:text-green-400'
      : aggregate === 'in_progress' ? 'bg-amber-500/18 border-amber-500/50 text-amber-600 dark:text-amber-400'
      : aggregate === 'mixed' ? 'bg-blue-500/18 border-blue-500/50 text-blue-600 dark:text-blue-400'
      : 'bg-slate-400/18 border-slate-400/50 text-slate-500 dark:text-slate-400';

  const aggIcon =
    aggregate === 'ready' ? '\u2713\u2713'
      : aggregate === 'in_progress' ? '\uD83D\uDD25'
      : aggregate === 'mixed' ? '\u25D0'
      : '\u25CB';

  return (
    <div
      className={`flex flex-col rounded-xl border-2 bg-[var(--surface)] shadow-md overflow-hidden ${borderClass}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5"
        style={{ background: `color-mix(in srgb, ${color} 10%, var(--surface, #fff))` }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[22px] font-black text-[var(--text,inherit)] tracking-wide leading-tight">
            {headerLabel}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {card.table_label && (
              <span className="text-[11px] font-semibold text-[var(--text3,#64748b)]">
                #{card.ticket_number}
              </span>
            )}
            {card.party_size != null && (
              <span className="text-[11px] font-semibold text-[var(--text3,#64748b)]">
                {L.partyOf(card.party_size)}
              </span>
            )}
            {card.customer_name && (
              <span className="text-[11px] font-semibold text-[var(--text3,#64748b)] truncate max-w-[120px]">
                {card.customer_name}
              </span>
            )}
          </div>
        </div>

        {/* Service-type pill — takeout (amber) or delivery (purple) only */}
        {svcPill ? (
          <div
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-extrabold"
            style={{
              background: `color-mix(in srgb, ${svcPill.color} 18%, transparent)`,
              border: `1px solid color-mix(in srgb, ${svcPill.color} 50%, transparent)`,
              color: svcPill.color,
            }}
          >
            <span>{svcPill.emoji}</span>
            <span>{svcPill.label}</span>
          </div>
        ) : null}

        {/* Aggregate pill */}
        <div className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-extrabold ${aggColorClass}`}>
          <span>{aggIcon}</span>
          <span>{aggLabel}</span>
        </div>

        {/* Age badge */}
        <div
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-white font-extrabold text-[13px]"
          style={{ background: color }}
        >
          <span>&#128336;</span>
          <span>{formatAge(minutes)}</span>
        </div>
      </div>

      {/* Items */}
      <div className="px-2 py-1">
        {card.items.map((it) => (
          <KitchenItemRow
            key={it.id}
            item={it}
            isNew={newItemIds.has(it.id)}
            busy={busy}
            L={L}
            onAdvance={onItemAdvance}
          />
        ))}
      </div>

      {/* Footer action */}
      <div className="px-2.5 py-2 border-t border-[var(--border)]">
        {allReady ? (
          <button
            type="button"
            onClick={() => !busy && onMarkAllServed(card)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-extrabold transition-opacity disabled:opacity-50 hover:bg-blue-700"
          >
            &#10003;&#10003; {L.markAllServed}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => !busy && onBumpAllReady(card)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-green-500 text-white text-sm font-extrabold transition-opacity disabled:opacity-50 hover:bg-green-600"
          >
            &#127859; {L.markAllReady}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterTab
// ---------------------------------------------------------------------------
interface FilterTabProps {
  label: string;
  count?: number;
  active: boolean;
  accent: string;
  onClick: () => void;
}

function FilterTab({ label, count, active, accent, onClick }: FilterTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        colorScheme: 'light dark',
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${accent} 14%, var(--surface))` : 'var(--surface)',
        color: active ? accent : 'var(--text)',
      }}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold aria-pressed:font-extrabold transition-all cursor-pointer"
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-black"
          style={{ background: accent }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// KitchenDisplayBoard — main exported component
// ---------------------------------------------------------------------------
interface BoardProps {
  officeId: string;
  organizationId: string;
  initialTickets: KitchenTicket[];
  screenToken: string;
  locale: 'fr' | 'ar' | 'en';
}

export function KitchenDisplayBoard({
  officeId, organizationId, initialTickets, screenToken, locale,
}: BoardProps) {
  const L = LABELS[locale as LocaleKey] ?? LABELS.fr;

  const [cards, setCards] = useState<KitchenTicket[]>(initialTickets);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');

  // Sort + Group controls — operator preference, persisted per device.
  // Same key namespace as desktop KDS so the two views stay symmetric.
  type KdsSortMode = 'time-asc' | 'time-desc' | 'status' | 'table' | 'items';
  type KdsGroupMode = 'none' | 'status' | 'table';
  const KDS_SORT_KEYS: KdsSortMode[] = ['time-asc', 'time-desc', 'status', 'table', 'items'];
  const KDS_GROUP_KEYS: KdsGroupMode[] = ['none', 'status', 'table'];
  const [sortMode, setSortMode] = useState<KdsSortMode>(() => {
    if (typeof window === 'undefined') return 'time-asc';
    try {
      const v = window.localStorage.getItem('qflo.kds.sort');
      return (KDS_SORT_KEYS as string[]).includes(v ?? '') ? (v as KdsSortMode) : 'time-asc';
    } catch { return 'time-asc'; }
  });
  const [groupMode, setGroupMode] = useState<KdsGroupMode>(() => {
    if (typeof window === 'undefined') return 'none';
    try {
      const v = window.localStorage.getItem('qflo.kds.group');
      return (KDS_GROUP_KEYS as string[]).includes(v ?? '') ? (v as KdsGroupMode) : 'none';
    } catch { return 'none'; }
  });
  const cycleSort = () => {
    const i = KDS_SORT_KEYS.indexOf(sortMode);
    const next = KDS_SORT_KEYS[(i + 1) % KDS_SORT_KEYS.length];
    setSortMode(next);
    try { window.localStorage.setItem('qflo.kds.sort', next); } catch {}
  };
  const cycleGroup = () => {
    const i = KDS_GROUP_KEYS.indexOf(groupMode);
    const next = KDS_GROUP_KEYS[(i + 1) % KDS_GROUP_KEYS.length];
    setGroupMode(next);
    try { window.localStorage.setItem('qflo.kds.group', next); } catch {}
  };

  const prevItemIdsRef = useRef<Set<string>>(new Set(initialTickets.flatMap((c) => c.items.map((i) => i.id))));
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());

  // ── Full reload from the web API ─────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/kitchen/tickets?screenToken=${encodeURIComponent(screenToken)}`);
      if (!res.ok) return;
      const data: KitchenTicket[] = await res.json();
      // Surface newly-arrived items with a highlight.
      const newIds = new Set<string>();
      const allIds = new Set<string>();
      for (const c of data) {
        for (const it of c.items) {
          allIds.add(it.id);
          if (!prevItemIdsRef.current.has(it.id) && prevItemIdsRef.current.size > 0) {
            newIds.add(it.id);
          }
        }
      }
      prevItemIdsRef.current = allIds;
      if (newIds.size > 0) {
        setNewItemIds(newIds);
        // Clear new-item highlight after 8 s so it doesn't stay forever.
        setTimeout(() => setNewItemIds(new Set()), 8_000);
      }
      setCards(data);
    } catch (e) {
      console.warn('[KitchenDisplayBoard] reload error', e);
    } finally {
      setLoading(false);
    }
  }, [screenToken]);

  // ── Initial load + 8 s poll ───────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(reload, 8_000);
    return () => clearInterval(id);
  }, [reload]);

  // ── Supabase realtime subscription ────────────────────────────────────────
  // ticket_items has no office_id column; we filter by organization_id instead.
  // This is slightly over-broad for multi-office orgs but realtime events are
  // cheap and the reload() call re-scopes to the correct office_id via the API.
  // Tickets subscription filters by office_id which is exact.
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`kitchen-${officeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ticket_items',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => reload(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `office_id=eq.${officeId}`,
        },
        () => reload(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [officeId, organizationId, reload]);

  // ── Per-item advance: new → in_progress → ready (ready → in_progress on undo) ──
  const handleItemAdvance = useCallback(async (item: KitchenItem) => {
    const cur = item.kitchen_status ?? 'new';
    const next: KitchenItem['kitchen_status'] =
      cur === 'new' ? 'in_progress'
        : cur === 'in_progress' ? 'ready'
        : 'in_progress'; // ready → un-bump back to in_progress

    // Optimistic update
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        items: c.items.map((it) =>
          it.id === item.id
            ? { ...it, kitchen_status: next, kitchen_status_at: new Date().toISOString() }
            : it,
        ),
      })),
    );

    try {
      const res = await fetch('/api/kitchen/update-item-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenToken, itemId: item.id, status: next }),
      });
      if (!res.ok) {
        console.warn('[KDS] update-item-status failed, reloading');
        reload();
      }
    } catch {
      reload();
    }
  }, [screenToken, reload]);

  // ── Bulk: mark all ready ──────────────────────────────────────────────────
  const handleBumpAllReady = useCallback(async (card: KitchenTicket) => {
    setBusy(true);
    setCards((prev) =>
      prev.map((c) =>
        c.ticket_id === card.ticket_id
          ? { ...c, items: c.items.map((it) => ({ ...it, kitchen_status: 'ready' as const })) }
          : c,
      ),
    );
    try {
      await fetch('/api/kitchen/bulk-update-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenToken, ticketId: card.ticket_id, action: 'mark_all_ready' }),
      });
    } catch {
      reload();
    } finally {
      setBusy(false);
    }
  }, [screenToken, reload]);

  // ── Bulk: mark all served ────────────────────────────────────────────────
  const handleMarkAllServed = useCallback(async (card: KitchenTicket) => {
    setBusy(true);
    // Optimistic remove — card disappears from KDS immediately
    setCards((prev) => prev.filter((c) => c.ticket_id !== card.ticket_id));
    try {
      await fetch('/api/kitchen/bulk-update-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenToken, ticketId: card.ticket_id, action: 'mark_all_served' }),
      });
    } catch {
      reload();
    } finally {
      setBusy(false);
    }
  }, [screenToken, reload]);

  // ── Filter + counts ───────────────────────────────────────────────────────
  const visibleCards = useMemo(() => {
    if (filter === 'all') return cards;
    return cards
      .map((c) => ({ ...c, items: c.items.filter((it) => (it.kitchen_status ?? 'new') === filter) }))
      .filter((c) => c.items.length > 0);
  }, [cards, filter]);

  // Sort + Group — mirror desktop KDS exactly so operators get parity.
  const aggregateOf = (items: KitchenItem[]): 'ready' | 'preparing' | 'mixed' | 'new' | 'none' => {
    if (items.length === 0) return 'none';
    const active = items.filter((i) => (i.kitchen_status ?? 'new') !== 'served');
    if (active.length === 0) return 'ready';
    const set = new Set(active.map((i) => i.kitchen_status ?? 'new'));
    if (set.size === 1) {
      const s = [...set][0];
      if (s === 'new') return 'new';
      if (s === 'in_progress') return 'preparing';
      if (s === 'ready') return 'ready';
    }
    return 'mixed';
  };
  const sortedCards = useMemo(() => {
    const arr = [...visibleCards];
    const byTimeAsc = (a: KitchenTicket, b: KitchenTicket) =>
      new Date(a.oldest_item_at).getTime() - new Date(b.oldest_item_at).getTime();
    if (sortMode === 'time-asc') arr.sort(byTimeAsc);
    else if (sortMode === 'time-desc') arr.sort((a, b) => -byTimeAsc(a, b));
    else if (sortMode === 'status') {
      const order: Record<string, number> = { ready: 0, preparing: 1, mixed: 2, new: 3, none: 4 };
      arr.sort((a, b) => (order[aggregateOf(a.items)] ?? 99) - (order[aggregateOf(b.items)] ?? 99) || byTimeAsc(a, b));
    } else if (sortMode === 'table') {
      arr.sort((a, b) => {
        const la = (a.table_label ?? a.ticket_number ?? '').toLowerCase();
        const lb = (b.table_label ?? b.ticket_number ?? '').toLowerCase();
        return la.localeCompare(lb, undefined, { numeric: true }) || byTimeAsc(a, b);
      });
    } else if (sortMode === 'items') {
      arr.sort((a, b) => b.items.reduce((s, i) => s + i.qty, 0) - a.items.reduce((s, i) => s + i.qty, 0) || byTimeAsc(a, b));
    }
    return arr;
  }, [visibleCards, sortMode]);

  const groupedCards = useMemo(() => {
    if (groupMode === 'none') return [{ key: 'all', label: '', items: sortedCards }];
    const map = new Map<string, { key: string; label: string; items: KitchenTicket[]; order: number }>();
    for (const card of sortedCards) {
      let key = 'other'; let label = ''; let order = 99;
      if (groupMode === 'status') {
        const ag = aggregateOf(card.items);
        key = ag;
        label = ag === 'ready' ? L.statusReady
          : ag === 'preparing' ? L.statusCooking
          : ag === 'new' ? L.statusNew
          : ag === 'mixed' ? L.statusCooking
          : '';
        order = ag === 'ready' ? 0 : ag === 'preparing' ? 1 : ag === 'mixed' ? 2 : ag === 'new' ? 3 : 4;
      } else if (groupMode === 'table') {
        if (card.table_label) {
          key = card.table_label; label = card.table_label; order = 0;
        } else {
          key = '__no_table__'; label = '#'; order = 1000;
        }
      }
      if (!map.has(key)) map.set(key, { key, label, items: [], order });
      map.get(key)!.items.push(card);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [sortedCards, groupMode, L]);

  const counts = useMemo(() => {
    const c = { new: 0, in_progress: 0, ready: 0 };
    for (const card of cards) {
      for (const it of card.items) {
        const s = (it.kitchen_status ?? 'new') as keyof typeof c;
        if (s in c) c[s]++;
      }
    }
    return c;
  }, [cards]);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[var(--text3,#64748b)]"
        style={{ background: 'var(--bg)' }}
      >
        {L.loading}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen overflow-hidden"
      style={{ background: 'var(--bg)', direction: dir }}
    >
      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-3.5 py-2 border-b border-[var(--border)]"
        style={{ background: 'var(--surface)' }}
      >
        <FilterTab
          label={L.filterAll}
          active={filter === 'all'}
          accent="var(--accent, #3b82f6)"
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={L.filterNew}
          count={counts.new}
          active={filter === 'new'}
          accent="#94a3b8"
          onClick={() => setFilter('new')}
        />
        <FilterTab
          label={L.filterCooking}
          count={counts.in_progress}
          active={filter === 'in_progress'}
          accent="#f59e0b"
          onClick={() => setFilter('in_progress')}
        />
        <FilterTab
          label={L.filterReady}
          count={counts.ready}
          active={filter === 'ready'}
          accent="#22c55e"
          onClick={() => setFilter('ready')}
        />

        {/* Sort + Group cycling buttons (parity with desktop KDS). */}
        <div style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 6 }}>
          <button
            onClick={cycleSort}
            title={L.sortByLabel}
            aria-label={L.sortByLabel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 12px', borderRadius: 14,
              border: '1.5px solid var(--border)',
              background: sortMode === 'time-asc' ? 'transparent' : 'var(--surface2, rgba(148,163,184,0.12))',
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
              color: sortMode === 'time-asc' ? 'var(--text3,#64748b)' : 'var(--text,inherit)',
              whiteSpace: 'nowrap',
              colorScheme: 'light dark',
            }}
          >
            {'↕'} {sortMode === 'time-asc' ? L.sortOldest
              : sortMode === 'time-desc' ? L.sortNewest
              : sortMode === 'status' ? L.sortStatus
              : sortMode === 'table' ? L.sortTable
              : L.sortItems}
          </button>
          <button
            onClick={cycleGroup}
            title={L.groupByLabel}
            aria-label={L.groupByLabel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 12px', borderRadius: 14,
              border: '1.5px solid var(--border)',
              background: groupMode === 'none' ? 'transparent' : 'var(--surface2, rgba(148,163,184,0.12))',
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
              color: groupMode === 'none' ? 'var(--text3,#64748b)' : 'var(--text,inherit)',
              whiteSpace: 'nowrap',
              colorScheme: 'light dark',
            }}
          >
            {'\u{1F4D1}'} {groupMode === 'none' ? L.groupNone
              : groupMode === 'status' ? L.groupStatus
              : L.groupTable}
          </button>
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-auto p-3.5">
        {visibleCards.length === 0 ? (
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 text-[var(--text3,#64748b)]">
            <span className="text-5xl">&#10004;</span>
            <div className="text-lg font-extrabold text-[var(--text,inherit)]">{L.allClear}</div>
            <div className="text-sm text-center max-w-xs">{L.noOrders}</div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {groupedCards.flatMap((group) => [
              ...(group.label ? [(
                <div
                  key={`group-${group.key}`}
                  style={{
                    gridColumn: '1 / -1',
                    fontSize: 12, fontWeight: 800, color: 'var(--text3,#64748b)',
                    textTransform: 'uppercase', letterSpacing: 1,
                    padding: '6px 4px 0',
                    borderTop: '1px solid var(--border)',
                    marginTop: 4,
                  }}
                >
                  {group.label} <span style={{ opacity: 0.6, fontWeight: 600 }}>· {group.items.length}</span>
                </div>
              )] : []),
              ...group.items.map((card) => (
                <KitchenTicketCard
                  key={card.ticket_id}
                  card={card}
                  newItemIds={newItemIds}
                  busy={busy}
                  L={L}
                  screenToken={screenToken}
                  onItemAdvance={handleItemAdvance}
                  onBumpAllReady={handleBumpAllReady}
                  onMarkAllServed={handleMarkAllServed}
                />
              )),
            ])}
          </div>
        )}
      </div>
    </div>
  );
}
