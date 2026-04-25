/**
 * Kitchen Display System (KDS) — Station renderer port of the Expo KDS.
 *
 * Restaurant / café only. Shows active tickets (called / serving) that
 * have at least one non-served item as a grid of cards. Operators click
 * items to advance them:  new → in_progress → ready.
 * Card-level "Mark all ready" / "Mark all served" bulk actions mirror
 * the Expo UX.
 *
 * Data: pulled from local SQLite via IPC `ticket-items:list-kitchen`,
 * synced to Supabase via the normal sync queue. Polled every 8 s +
 * listens to `ticketItems:changed` / `tickets:changed` IPC events so
 * any OrderPad or FloorMap mutation reflects immediately.
 *
 * Theme: uses CSS vars (--bg, --surface, --text, --border, --surface2).
 * colorScheme set on form controls so Chromium renders native caret
 * correctly in both light and dark themes.
 * RTL-safe: uses logical CSS (margin-inline-start, text-align: start).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
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
  items: KitchenItem[];
}

type FilterMode = 'all' | 'new' | 'in_progress' | 'ready';
type KitchenStatus = 'new' | 'in_progress' | 'ready' | 'served';

// ---------------------------------------------------------------------------
// i18n strings (FR / AR / EN)
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
  },
} as const;
type LocaleKey = keyof typeof LABELS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ageMinutes(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

function formatAge(min: number): string {
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? `${min % 60}m` : ''}`;
}

// ---------------------------------------------------------------------------
// KitchenItemRow
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: KitchenItem;
  isNew: boolean;
  busy: boolean;
  locale: LocaleKey;
  onAdvance: (item: KitchenItem) => void;
}

function KitchenItemRow({ item, isNew, busy, locale, onAdvance }: ItemRowProps) {
  const L = LABELS[locale];
  const status = item.kitchen_status ?? 'new';

  const statusColor =
    status === 'ready' ? 'var(--kds-ready, #22c55e)'
      : status === 'in_progress' ? 'var(--kds-warn, #f59e0b)'
      : 'var(--kds-new, #94a3b8)';

  const statusLabel =
    status === 'ready' ? L.statusReady
      : status === 'in_progress' ? L.statusCooking
      : L.statusNew;

  const isReady = status === 'ready';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.name} — ${statusLabel}`}
      onClick={() => !busy && onAdvance(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) onAdvance(item); } }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 6px',
        borderRadius: 6,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
        transition: 'background 0.15s',
        background: isNew ? 'color-mix(in srgb, var(--kds-warn, #f59e0b) 12%, transparent)' : 'transparent',
        outline: 'none',
      }}
      onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2, rgba(148,163,184,0.08))'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isNew ? 'color-mix(in srgb, var(--kds-warn, #f59e0b) 12%, transparent)' : 'transparent'; }}
    >
      {/* Qty badge */}
      <div style={{
        minWidth: 36, height: 36, borderRadius: 6,
        background: 'color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--accent, #3b82f6)' }}>
          &times;{item.qty}
        </span>
      </div>

      {/* Name + note */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700,
          color: isReady ? 'var(--text3, #64748b)' : 'var(--text)',
          textDecoration: isReady ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.name}
        </div>
        {item.note ? (
          <div style={{ fontSize: 11, color: 'var(--kds-warn, #f59e0b)', fontStyle: 'italic', marginBlockStart: 1 }}>
            {item.note}
          </div>
        ) : null}
      </div>

      {/* Status pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${statusColor} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${statusColor} 40%, transparent)`,
        flexShrink: 0,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: statusColor }}>{statusLabel}</span>
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
  locale: LocaleKey;
  orgId: string;
  onItemAdvance: (item: KitchenItem) => void;
  onBumpAllReady: (card: KitchenTicket) => void;
  onMarkAllServed: (card: KitchenTicket) => void;
}

function KitchenTicketCard({
  card, newItemIds, busy, locale, onItemAdvance, onBumpAllReady, onMarkAllServed,
}: CardProps) {
  const L = LABELS[locale];

  // Tick every 30 s so the age badge stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const minutes = ageMinutes(card.oldest_item_at);
  const urgencyColor =
    minutes < 5 ? 'var(--kds-ready, #22c55e)'
      : minutes < 10 ? 'var(--kds-warn, #f59e0b)'
      : 'var(--kds-err, #ef4444)';

  const allReady = card.items.every((it) => it.kitchen_status === 'ready');
  const headerLabel = card.table_label ?? `#${card.ticket_number}`;

  // Aggregate kitchen status for the whole order — surfaces a single
  // header badge so the line cook can read a card's state in one
  // glance without scanning every row. Per-item pills still tell the
  // detailed story below; this is the "TL;DR".
  const aggregate: 'new' | 'in_progress' | 'ready' | 'mixed' = (() => {
    if (!card.items.length) return 'new';
    const set = new Set(card.items.map((it) => it.kitchen_status));
    if (set.size === 1) return Array.from(set)[0] as any;
    return 'mixed';
  })();
  const aggLabel = aggregate === 'ready' ? L.statusReady
    : aggregate === 'in_progress' ? L.statusCooking
    : aggregate === 'mixed' ? (locale === 'fr' ? 'Partiel' : locale === 'ar' ? 'جزئي' : 'Partial')
    : L.statusNew;
  const aggColor = aggregate === 'ready' ? 'var(--kds-ready, #22c55e)'
    : aggregate === 'in_progress' ? 'var(--kds-warn, #f59e0b)'
    : aggregate === 'mixed' ? 'var(--accent, #3b82f6)'
    : 'var(--text3, #64748b)';
  const aggIcon = aggregate === 'ready' ? '\u2713\u2713'
    : aggregate === 'in_progress' ? '\uD83D\uDD25'
    : aggregate === 'mixed' ? '\u25D0'
    : '\u25CB';

  return (
    <div style={{
      background: 'var(--surface)',
      border: `2px solid color-mix(in srgb, ${urgencyColor} 55%, var(--border))`,
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: `color-mix(in srgb, ${urgencyColor} 10%, var(--surface))`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: 0.5 }}>
            {headerLabel}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBlockStart: 2 }}>
            {card.table_label && (
              <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', fontWeight: 600 }}>
                #{card.ticket_number}
              </span>
            )}
            {card.party_size ? (
              <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', fontWeight: 600 }}>
                {L.partyOf(card.party_size)}
              </span>
            ) : null}
            {card.customer_name ? (
              <span style={{
                fontSize: 11, color: 'var(--text3, #64748b)', fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {card.customer_name}
              </span>
            ) : null}
          </div>
        </div>
        {/* Aggregate order status pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          borderRadius: 999,
          background: `color-mix(in srgb, ${aggColor} 18%, transparent)`,
          border: `1px solid color-mix(in srgb, ${aggColor} 50%, transparent)`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: aggColor }}>{aggIcon}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: aggColor }}>{aggLabel}</span>
        </div>
        {/* Age badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px',
          borderRadius: 999,
          background: urgencyColor,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11 }}>&#128336;</span>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>{formatAge(minutes)}</span>
        </div>
      </div>

      {/* Items */}
      <div style={{ padding: '4px 8px' }}>
        {card.items.map((it) => (
          <KitchenItemRow
            key={it.id}
            item={it}
            isNew={newItemIds.has(it.id)}
            busy={busy}
            locale={locale}
            onAdvance={onItemAdvance}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 10px',
        borderBlockStart: '1px solid var(--border)',
      }}>
        {allReady ? (
          <button
            type="button"
            onClick={() => !busy && onMarkAllServed(card)}
            disabled={busy}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '9px 0', borderRadius: 8, border: 'none',
              background: 'var(--accent, #3b82f6)',
              color: '#fff', fontWeight: 800, fontSize: 14,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            &#10003;&#10003; {L.markAllServed}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => !busy && onBumpAllReady(card)}
            disabled={busy}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '9px 0', borderRadius: 8, border: 'none',
              background: 'var(--kds-ready, #22c55e)',
              color: '#fff', fontWeight: 800, fontSize: 14,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
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
  accent?: string;
  onClick: () => void;
}

function FilterTab({ label, count, active, accent = 'var(--accent, #3b82f6)', onClick }: FilterTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${accent} 14%, var(--surface))` : 'var(--surface)',
        color: active ? accent : 'var(--text)',
        fontWeight: active ? 800 : 600,
        fontSize: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
        colorScheme: 'light dark',
      }}
    >
      {label}
      {typeof count === 'number' && count > 0 ? (
        <span style={{
          minWidth: 18, height: 18, borderRadius: 9,
          paddingInline: 4,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: accent,
          color: '#fff', fontSize: 10, fontWeight: 900,
        }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// KitchenDisplay — main component
// ---------------------------------------------------------------------------
interface Props {
  orgId: string;
  locale: 'en' | 'fr' | 'ar';
}

export function KitchenDisplay({ orgId, locale }: Props) {
  const L = LABELS[locale as LocaleKey] ?? LABELS.en;

  const [cards, setCards] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');

  const prevItemIdsRef = useRef<Set<string>>(new Set());
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!orgId) { setCards([]); setLoading(false); return; }
    try {
      const data = await (window as any).qf?.ticketItems?.listKitchen(orgId) ?? [];
      const incoming: KitchenTicket[] = Array.isArray(data) ? data : [];
      // Diff to surface newly-added items.
      const newIds = new Set<string>();
      const allIds = new Set<string>();
      for (const c of incoming) {
        for (const it of c.items) {
          allIds.add(it.id);
          if (!prevItemIdsRef.current.has(it.id) && prevItemIdsRef.current.size > 0) {
            newIds.add(it.id);
          }
        }
      }
      prevItemIdsRef.current = allIds;
      setNewItemIds(newIds);
      setCards(incoming);
    } catch (e) {
      console.warn('[KitchenDisplay] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Initial load + 8 s poll.
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  // Push-based refresh on ticket / ticketItem changes.
  useEffect(() => {
    const unsubTickets = (window as any).qf?.tickets?.onChange?.(() => load());
    const unsubItems = (window as any).qf?.ticketItems?.onChange?.(() => load());
    return () => {
      unsubTickets?.();
      unsubItems?.();
    };
  }, [load]);

  // Single item advance: new → in_progress → ready (→ in_progress on un-bump).
  const handleItemAdvance = useCallback(async (item: KitchenItem) => {
    const cur = item.kitchen_status ?? 'new';
    const next: KitchenStatus =
      cur === 'new' ? 'in_progress'
        : cur === 'in_progress' ? 'ready'
        : 'in_progress';
    // Optimistic update.
    setCards((prev) => prev.map((c) => ({
      ...c,
      items: c.items.map((it) =>
        it.id === item.id ? { ...it, kitchen_status: next, kitchen_status_at: new Date().toISOString() } : it,
      ),
    })));
    try {
      await (window as any).qf?.ticketItems?.updateKitchenStatus(item.id, orgId, next);
    } catch (e) {
      console.warn('[KitchenDisplay] item advance failed', e);
      load();
    }
  }, [orgId, load]);

  const handleBumpAllReady = useCallback(async (card: KitchenTicket) => {
    setBusy(true);
    setCards((prev) => prev.map((c) =>
      c.ticket_id === card.ticket_id
        ? { ...c, items: c.items.map((it) => ({ ...it, kitchen_status: 'ready' as const })) }
        : c,
    ));
    try {
      await (window as any).qf?.ticketItems?.bumpTicketKitchen(card.ticket_id, orgId, 'ready');
    } catch (e) {
      console.warn('[KitchenDisplay] bump-all failed', e);
      load();
    } finally {
      setBusy(false);
    }
  }, [orgId, load]);

  const handleMarkAllServed = useCallback(async (card: KitchenTicket) => {
    setBusy(true);
    // Optimistic remove.
    setCards((prev) => prev.filter((c) => c.ticket_id !== card.ticket_id));
    try {
      await (window as any).qf?.ticketItems?.bumpTicketKitchen(card.ticket_id, orgId, 'served');
    } catch (e) {
      console.warn('[KitchenDisplay] mark-served failed', e);
      load();
    } finally {
      setBusy(false);
    }
  }, [orgId, load]);

  // Filter + counts.
  const visibleCards = useMemo(() => {
    if (filter === 'all') return cards;
    return cards
      .map((c) => ({ ...c, items: c.items.filter((it) => (it.kitchen_status ?? 'new') === filter) }))
      .filter((c) => c.items.length > 0);
  }, [cards, filter]);

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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3, #64748b)' }}>
        {L.loading}
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'var(--bg)',
      direction: dir,
    }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '8px 14px',
        borderBlockEnd: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <FilterTab
          label={L.filterAll}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={L.filterNew}
          count={counts.new}
          active={filter === 'new'}
          accent="var(--kds-new, #94a3b8)"
          onClick={() => setFilter('new')}
        />
        <FilterTab
          label={L.filterCooking}
          count={counts.in_progress}
          active={filter === 'in_progress'}
          accent="var(--kds-warn, #f59e0b)"
          onClick={() => setFilter('in_progress')}
        />
        <FilterTab
          label={L.filterReady}
          count={counts.ready}
          active={filter === 'ready'}
          accent="var(--kds-ready, #22c55e)"
          onClick={() => setFilter('ready')}
        />
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {visibleCards.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 8, color: 'var(--text3, #64748b)',
          }}>
            <span style={{ fontSize: 48 }}>&#10004;</span>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{L.allClear}</div>
            <div style={{ fontSize: 13, color: 'var(--text3, #64748b)', textAlign: 'center', maxWidth: 320 }}>
              {L.noOrders}
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            alignItems: 'start',
          }}>
            {visibleCards.map((card) => (
              <KitchenTicketCard
                key={card.ticket_id}
                card={card}
                newItemIds={newItemIds}
                busy={busy}
                locale={locale as LocaleKey}
                orgId={orgId}
                onItemAdvance={handleItemAdvance}
                onBumpAllReady={handleBumpAllReady}
                onMarkAllServed={handleMarkAllServed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
