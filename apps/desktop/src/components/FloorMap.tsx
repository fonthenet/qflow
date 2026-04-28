import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { cloudFetch } from '../lib/cloud-fetch';
import { useConfirmDialog } from './ConfirmDialog';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { OrderPad, type TicketItem } from './OrderPad';
import { PaymentModal } from './PaymentModal';
import { ZReportModal } from './ZReportModal';
import { TicketCompletionSummaryModal } from './TicketCompletionSummary';
import { formatMoney } from '../lib/money';

const CLOUD_URL = 'https://qflo.net';
import {
  matchTablesForParty,
  parsePartySize,
  summarizeOccupancy,
  resolveRestaurantServiceType,
  type RestaurantTable,
  type TableStatus,
} from '@qflo/shared';

// ── Floor map for multi-table restaurant service ──────────────────
// Shows every table for the current office with live status, a seat-
// timer on occupied tables, and per-table actions: seat the next
// waiting ticket, complete, cancel, or transfer to another table.
//
// All writes go through Supabase so web + mobile + Station stay in
// sync. The Postgres trigger release_table_on_ticket_terminal frees
// a table whenever its ticket reaches a terminal state, so `Complete`
// and `Cancel` here auto-clear the seat server-side.

interface Props {
  officeId: string | null;
  staffId: string | null;
  deskId: string | null;
  locale: DesktopLocale;
  orgId: string | null;
  currency?: string;
  decimals?: number;
  onOpenMenu?: () => void;
}

interface SeatedTicket {
  id: string;
  ticket_number: string;
  customer_data: any;
  status: string;
  serving_started_at: string | null;
  called_at: string | null;
  created_at: string;
  service_id?: string | null;
}

const STATUS_COLORS: Record<TableStatus, { border: string; bg: string; label: string }> = {
  available: { border: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: '#86efac' },
  occupied:  { border: '#ef4444', bg: 'rgba(239,68,68,0.14)',  label: '#fca5a5' },
  reserved:  { border: '#3b82f6', bg: 'rgba(59,130,246,0.14)', label: '#93c5fd' },
  cleaning:  { border: '#f59e0b', bg: 'rgba(245,158,11,0.14)', label: '#fcd34d' },
  disabled:  { border: '#64748b', bg: 'rgba(100,116,139,0.10)', label: '#cbd5e1' },
};

// Visual override for a table holding a 'called' ticket — the DB still
// reads 'occupied' but we want the host to see the distinct "calling"
// state. Mapped on the fly from the ticket's status.
const CALLING_COLORS = { border: '#eab308', bg: 'rgba(234,179,8,0.14)', label: '#fde047' };

export function FloorMap({ officeId, staffId, deskId, locale, orgId, currency = '', decimals = 2, onOpenMenu }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const fmtMoney = useCallback((n: number) => formatMoney(n, currency, decimals), [currency, decimals]);
  const { confirm: dialogConfirm, alert: dialogAlert } = useConfirmDialog();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [tickets, setTickets] = useState<SeatedTicket[]>([]);
  const [waiting, setWaiting] = useState<SeatedTicket[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<RestaurantTable | null>(null);
  // Table-first action flow: operator taps Call or Seat on an available tile,
  // picks any waiting ticket from the modal (not just "next"). Single entry
  // point — waiting strip below is read-only.
  const [pickCustomerFor, setPickCustomerFor] = useState<{ table: RestaurantTable; mode: 'call' | 'seat' } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [completionSummary, setCompletionSummary] = useState<{
    ticketNumber: string;
    customerName: string | null;
    partySize: number | null;
    tableCode: string;
    calledAt: string | null;
    seatedAt: string | null;
    completedAt: string;
    items: TicketItem[];
    itemsTotal: number;
    payment: { method: 'cash'; amount: number; tendered: number; change: number } | null;
  } | null>(null);
  // Ticket items grouped by ticket_id so each serving tile can show its tally
  // (item count + price total) and the OrderPad knows the current order.
  const [itemsByTicket, setItemsByTicket] = useState<Map<string, TicketItem[]>>(new Map());
  const [orderPadFor, setOrderPadFor] = useState<{ ticket: SeatedTicket; table: RestaurantTable } | null>(null);
  // When the operator taps Complete on a table with priced items, we
  // capture payment first through PaymentModal — only once the cash is
  // recorded do we run the actual ticket→served transition.
  const [payingFor, setPayingFor] = useState<{ ticket: SeatedTicket; table: RestaurantTable; items: TicketItem[]; total: number } | null>(null);
  const [showZReport, setShowZReport] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const [, tick] = useState(0);

  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    setTimeout(() => setToast((curr) => (curr && curr.msg === msg ? null : curr)), 3500);
  };

  // 1 Hz ticker so seat timers refresh.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!officeId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const token = await ensureAuth();
      if (!token) {
        setLoadError('Not authenticated — sign in again to load the floor map.');
        return;
      }
      const sb = await getSupabase();
      const [tr, wait] = await Promise.all([
        sb.from('restaurant_tables')
          .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
          .eq('office_id', officeId).order('code'),
        sb.from('tickets')
          .select('id, ticket_number, customer_data, status, serving_started_at, called_at, created_at, service_id')
          .eq('office_id', officeId)
          .in('status', ['waiting', 'called', 'serving'])
          .order('created_at', { ascending: true }),
      ]);
      if (tr.error) {
        console.error('[FloorMap] restaurant_tables load failed', tr.error);
        setLoadError(`Tables load failed: ${tr.error.message}`);
        return;
      }
      if (wait.error) {
        console.error('[FloorMap] tickets load failed', wait.error);
      }
      const tableRows = (tr.data ?? []) as RestaurantTable[];
      // Natural sort so T2 comes before T10 (server-side .order('code') is
      // lexicographic — "T1, T10, T11, T2, T3..." — which misreads as random
      // on the floor map). Intl.Collator with numeric:true handles T1/T10
      // correctly and also works for mixed zones like "A1, A2, B1, B10".
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      tableRows.sort((a, b) => collator.compare(a.code ?? '', b.code ?? ''));
      const ticketRows = (wait.data ?? []) as SeatedTicket[];
      // Resolve service names for tickets that have a service_id. The
      // services table is keyed by department_id, not office_id — so we
      // can't filter by office. Instead, look up only the unique service
      // IDs the tickets actually reference. Empty result is fine: those
      // tickets fall through as service-less (type 'other') and the
      // floor map shows them in waiting (safe default for ambiguous).
      const referencedSvcIds = Array.from(
        new Set(ticketRows.map((t) => t.service_id).filter((id): id is string => !!id)),
      );
      const serviceNames = new Map<string, string>();
      if (referencedSvcIds.length > 0) {
        const svc = await sb.from('services').select('id, name').in('id', referencedSvcIds);
        for (const s of (svc.data ?? []) as any[]) {
          if (s?.id && s?.name) serviceNames.set(s.id, s.name);
        }
      }
      setTables(tableRows);
      const seatedIds = new Set(tableRows.filter((x) => x.current_ticket_id).map((x) => x.current_ticket_id!));
      setTickets(ticketRows.filter((x) => seatedIds.has(x.id)));
      // Floor-map waiting strip is for DINE-IN only. Takeout + delivery
      // never get a table assigned and are handled by the queue canvas;
      // showing them here just adds noise for the host. Tickets without
      // a service_id, or services that don't match the takeout/delivery
      // patterns, fall through as eligible (catches walk-ins and any
      // restaurant that hasn't split its services yet).
      setWaiting(ticketRows.filter((x) => {
        if (x.status !== 'waiting' || seatedIds.has(x.id)) return false;
        const svcName = x.service_id ? serviceNames.get(x.service_id) ?? '' : '';
        const svcType = resolveRestaurantServiceType(svcName);
        return svcType !== 'takeout' && svcType !== 'delivery';
      }));
    } catch (e: any) {
      console.error('[FloorMap] load exception', e);
      setLoadError(e?.message ?? 'Failed to load floor map');
    } finally {
      setLoading(false);
    }
  }, [officeId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(load);
    return () => { unsub?.(); };
  }, [load]);

  // Load ticket_items for every seated ticket so serving tiles can show a
  // live tally (N items · total). Refreshes on every ticket change so the
  // OrderPad and the tile stay in sync across sessions.
  const loadTicketItems = useCallback(async () => {
    try {
      const ids = tickets.filter((x) => x.status === 'serving').map((x) => x.id);
      if (ids.length === 0) { setItemsByTicket(new Map()); return; }
      const rows: TicketItem[] = (await (window as any).qf?.ticketItems?.listForTickets?.(ids)) ?? [];
      const map = new Map<string, TicketItem[]>();
      for (const r of rows) {
        if (!map.has(r.ticket_id)) map.set(r.ticket_id, []);
        map.get(r.ticket_id)!.push(r);
      }
      setItemsByTicket(map);
    } catch (err) {
      console.warn('[FloorMap] loadTicketItems failed', err);
    }
  }, [tickets]);
  useEffect(() => { loadTicketItems(); }, [loadTicketItems]);
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(loadTicketItems);
    return () => { unsub?.(); };
  }, [loadTicketItems]);

  const occupancy = useMemo(() => summarizeOccupancy(tables), [tables]);

  // Supabase is the source of truth for the floor map (load() reads
  // tickets from there). Write authoritatively to Supabase first, then
  // fire the desktop IPC as a fire-and-forget side-effect so local
  // SQLite stays mirrored and the notification pipeline (WhatsApp /
  // Messenger / voice announce) still runs. If IPC fails or is
  // stale, the sync engine reconciles from cloud on its own.
  const writeTicket = async (ticketId: string, updates: Record<string, any>, tableCode?: string) => {
    console.log('[FloorMap] writeTicket', { ticketId, updates, tableCode });
    const token = await ensureAuth();
    if (!token) {
      await dialogAlert(t('Not signed in — please log out and back in.'));
      throw new Error('ensureAuth returned empty token');
    }
    const sb = await getSupabase();
    const { error } = await sb.from('tickets').update(updates).eq('id', ticketId);
    if (error) {
      console.error('[FloorMap] ticket update failed', error, { ticketId, updates });
      await dialogAlert(`${t('Update failed')}: ${error.message}`);
      throw error;
    }
    // Pass the table code as deskName override so the WhatsApp/Messenger
    // template renders "please go to T3" instead of the empty "?".
    try {
      await (window as any).qf?.db?.updateTicket?.(ticketId, updates, tableCode ? { deskName: tableCode } : undefined);
    } catch (err) {
      console.warn('[FloorMap] IPC mirror failed (non-fatal)', err);
    }
  };

  // Call a specific waiting ticket to a specific table (waiting → called).
  // In restaurant mode the ticket's desk_id MUST stay NULL — the DB trigger
  // check_desk_capacity rejects a second called/serving ticket per desk, but
  // one host stand legitimately runs many tables concurrently. The
  // ticket↔table binding lives in restaurant_tables.current_ticket_id; audit
  // still works via called_by_staff_id. Pass the table code as deskName so
  // the customer's notification reads "please go to T3".
  const callTicketToTable = async (table: RestaurantTable, ticketId: string) => {
    setBusy(table.id);
    try {
      const nowIso = new Date().toISOString();
      await writeTicket(ticketId, {
        status: 'called',
        desk_id: null,
        called_at: nowIso,
        called_by_staff_id: staffId,
      }, table.code);
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('restaurant_tables').update({
        status: 'occupied',
        current_ticket_id: ticketId,
        assigned_at: nowIso,
      }).eq('id', table.id);
      await load();
    } finally { setBusy(null); }
  };

  // Seat a specific waiting ticket at a specific table in one step (waiting
  // → serving). Use when the party is already at the host stand. Same
  // desk_id-null constraint as callTicketToTable.
  const seatTicketAtTable = async (table: RestaurantTable, ticketId: string) => {
    setBusy(table.id);
    try {
      const nowIso = new Date().toISOString();
      await writeTicket(ticketId, {
        status: 'serving',
        desk_id: null,
        called_at: nowIso,
        called_by_staff_id: staffId,
        serving_started_at: nowIso,
      }, table.code);
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('restaurant_tables').update({
        status: 'occupied',
        current_ticket_id: ticketId,
        assigned_at: nowIso,
      }).eq('id', table.id);
      // The "seated" WhatsApp/Messenger notification is sent by the IPC
      // mirror inside writeTicket above — main.ts:db:update-ticket calls
      // /api/ticket-transition with deskName=tableCode for serving transitions.
      // Do NOT fire a second notification here (caused duplicate "service
      // has started" WhatsApp messages in production).
      await load();
    } finally { setBusy(null); }
  };

  const confirmSeated = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    setBusy(table.id);
    try {
      const nowIso = new Date().toISOString();
      await writeTicket(table.current_ticket_id, {
        status: 'serving',
        serving_started_at: nowIso,
      }, table.code);
      // Reset assigned_at to the seated moment so the timer reflects
      // actual butt-in-seat time, not the earlier call time.
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('restaurant_tables').update({ assigned_at: nowIso }).eq('id', table.id);
      // Serving notification is emitted by the IPC mirror in writeTicket
      // (main.ts → /api/ticket-transition). Firing a second explicit notify
      // here produced duplicate WhatsApp messages.
      await load();
    } finally { setBusy(null); }
  };

  const releaseTable = async (table: RestaurantTable) => {
    setBusy(table.id);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('restaurant_tables').update({
        status: 'available', current_ticket_id: null, assigned_at: null,
      }).eq('id', table.id);
      await load();
    } finally { setBusy(null); }
  };

  // Terminal transitions rely on the DB trigger
  // release_table_on_ticket_terminal to clear the table row. We still
  // explicitly clear here as a safety net — the trigger is idempotent.
  const clearTableRow = async (tableId: string) => {
    const sb = await getSupabase();
    await sb.from('restaurant_tables').update({
      status: 'available', current_ticket_id: null, assigned_at: null,
    }).eq('id', tableId);
  };

  const completeAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    const tk = ticketFor(table.current_ticket_id);
    const capturedItems: TicketItem[] = tk ? (itemsByTicket.get(tk.id) ?? []) : [];
    const itemsTotal = capturedItems.reduce((s, ti) => s + (ti.price != null ? ti.price * ti.qty : 0), 0);
    // Has something to charge → go through PaymentModal first. The modal
    // handles the confirm + cash capture + optional receipt print, then
    // calls back into finalizeComplete to run the actual ticket
    // transition. Free visits (no priced items) keep the simple confirm.
    if (tk && itemsTotal > 0) {
      setPayingFor({ ticket: tk, table, items: capturedItems, total: itemsTotal });
      return;
    }
    if (!(await dialogConfirm(t('Complete visit at {code}?', { code: table.code }), { confirmLabel: t('Complete'), variant: 'info' }))) return;
    await finalizeComplete(table, tk ?? null, capturedItems, itemsTotal);
  };

  const finalizeComplete = async (
    table: RestaurantTable,
    tk: SeatedTicket | null,
    capturedItems: TicketItem[],
    itemsTotal: number,
    payment: { method: 'cash'; amount: number; tendered: number; change: number } | null = null,
  ) => {
    if (!table.current_ticket_id) return;
    setBusy(table.id);
    try {
      const completedAt = new Date().toISOString();
      await writeTicket(table.current_ticket_id, {
        status: 'served',
        completed_at: completedAt,
        payment_status: itemsTotal > 0 ? 'paid' : null,
      }, table.code);
      await ensureAuth();
      await clearTableRow(table.id);
      if (tk) {
        setCompletionSummary({
          ticketNumber: tk.ticket_number,
          customerName: tk.customer_data?.name ?? null,
          partySize: parsePartySize(tk.customer_data?.party_size),
          tableCode: table.code,
          calledAt: tk.called_at ?? null,
          seatedAt: tk.serving_started_at ?? table.assigned_at ?? null,
          completedAt,
          items: capturedItems,
          itemsTotal,
          payment,
        });
      }
      await load();
    } finally { setBusy(null); }
  };

  const cancelAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    if (!(await dialogConfirm(t('Cancel ticket at {code}?', { code: table.code }), { confirmLabel: t('Cancel ticket'), variant: 'danger' }))) return;
    setBusy(table.id);
    try {
      await writeTicket(table.current_ticket_id, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      await ensureAuth();
      await clearTableRow(table.id);
      await load();
    } finally { setBusy(null); }
  };

  const noShowAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    if (!(await dialogConfirm(t('Mark as no-show at {code}?', { code: table.code }), { confirmLabel: t('No-show'), variant: 'danger' }))) return;
    setBusy(table.id);
    try {
      // Dedicated no_show status — keeps reporting distinct from
      // operator-cancelled and frees the table immediately.
      await writeTicket(table.current_ticket_id, {
        status: 'no_show',
        completed_at: new Date().toISOString(),
      });
      await ensureAuth();
      await clearTableRow(table.id);
      await load();
    } finally { setBusy(null); }
  };

  const transferTo = async (destination: RestaurantTable) => {
    if (!transferFor || !transferFor.current_ticket_id) return;
    setBusy(destination.id);
    try {
      const token = await ensureAuth();
      const sb = await getSupabase();
      const ticketId = transferFor.current_ticket_id;
      const tk = ticketFor(ticketId);
      const nowIso = new Date().toISOString();
      // Move the table assignment only — the ticket itself stays in
      // serving with the same desk/staff. Direct Supabase since
      // restaurant_tables isn't in local SQLite.
      await sb.from('restaurant_tables').update({
        status: 'occupied', current_ticket_id: ticketId, assigned_at: nowIso,
      }).eq('id', destination.id);
      await sb.from('restaurant_tables').update({
        status: 'available', current_ticket_id: null, assigned_at: null,
      }).eq('id', transferFor.id);
      const fromCode = transferFor.code;
      showToast(t('Moved {ticket} from {from} → {to}. Customer notified.', {
        ticket: tk?.ticket_number ?? '',
        from: fromCode,
        to: destination.code,
      }), 'success');
      // Notify the customer about the table change via WhatsApp/Messenger.
      // Reuse the 'buzz' template ("Staff is trying to reach you — please
      // go to {desk}") with the destination code so the customer knows
      // where to move. skipStatusUpdate keeps the ticket in 'serving'.
      if (token && tk) {
        const currentStatus = tk.status === 'called' ? 'called' : 'serving';
        cloudFetch(`${CLOUD_URL}/api/ticket-transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ticketId,
            status: currentStatus,
            skipStatusUpdate: true,
            notifyEvent: 'table_changed',
            deskName: destination.code,
          }),
        }).catch((err) => console.warn('[FloorMap] transfer notify failed', err));
      }
      setTransferFor(null);
      await load();
    } finally { setBusy(null); }
  };

  if (!officeId) return null;
  if (loading && tables.length === 0) {
    return (
      <div style={emptyWrap}>
        <div style={{ color: 'var(--text2)', fontSize: 14 }}>{t('Loading floor map…')}</div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={emptyWrap}>
        <div style={{ fontSize: 32, opacity: 0.5 }}>⚠️</div>
        <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 10, maxWidth: 520, textAlign: 'center' }}>
          {loadError}
        </div>
        <button onClick={() => load()} style={{ ...btnGhost, marginTop: 12 }}>{t('Retry')}</button>
      </div>
    );
  }
  if (tables.length === 0) {
    return (
      <div style={emptyWrap}>
        <div style={{ fontSize: 48, opacity: 0.4 }}>🍽️</div>
        <div style={{ color: 'var(--text2)', fontSize: 14, marginTop: 10 }}>
          {t('No tables yet. Add them in Business Administration → Tables.')}
        </div>
      </div>
    );
  }

  const ticketFor = (id: string | null | undefined) => tickets.find((x) => x.id === id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, height: '100%', overflow: 'auto', position: 'relative' }}>
      {toast && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 20px',
            borderRadius: 10,
            background: toast.kind === 'success' ? '#16a34a' : '#ef4444',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            zIndex: 10001,
            maxWidth: '80vw',
          }}
          onClick={() => setToast(null)}
        >
          {toast.msg}
        </div>,
        document.body,
      )}
      {/* Occupancy strip */}
      <div style={occStrip}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text2)' }}>
          🍽️ {t('Floor map')} · {tables.length} {t('tables')}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <Stat label={t('Available')} value={occupancy.available} color="#22c55e" />
          <Stat label={t('Occupied')} value={occupancy.occupied} color="#ef4444" />
          {occupancy.reserved > 0 && <Stat label={t('Reserved')} value={occupancy.reserved} color="#3b82f6" />}
          {occupancy.cleaning > 0 && <Stat label={t('Cleaning')} value={occupancy.cleaning} color="#f59e0b" />}
          <Stat label={t('Waiting')} value={waiting.length} color="#a855f7" />
          <Stat
            label={t('Utilisation')}
            value={`${Math.round(occupancy.seatUtilisation * 100)}%`}
            color={occupancy.seatUtilisation > 0.8 ? '#ef4444' : occupancy.seatUtilisation > 0.6 ? '#f59e0b' : '#22c55e'}
          />
          {onOpenMenu && (
            <button
              onClick={onOpenMenu}
              title={t('Edit menu')}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              🍽 {t('Menu')}
            </button>
          )}
          <button
            onClick={() => setShowZReport(true)}
            title={t('Daily Z-Report')}
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            📊 {t('Z-Report')}
          </button>
        </div>
      </div>

      {transferFor && (
        <div style={transferBanner}>
          <span>🔀 {t('Select a destination table for {code}', { code: transferFor.code })}</span>
          <button onClick={() => setTransferFor(null)} style={btnGhost}>{t('Cancel')}</button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, alignContent: 'start', gridAutoRows: '1fr' }}>
        {tables.map((table) => {
          const tk = ticketFor(table.current_ticket_id);
          const isCalling = tk?.status === 'called';
          const isServing = tk?.status === 'serving';
          const colors = isCalling ? CALLING_COLORS : STATUS_COLORS[table.status];
          const timerIso = isServing ? tk?.serving_started_at ?? table.assigned_at : isCalling ? tk?.called_at ?? table.assigned_at : null;
          const elapsed = timerIso ? elapsedFromIso(timerIso) : null;
          const elapsedMin = timerIso ? minutesSinceIso(timerIso) : 0;
          // Timer color ramps after 60/90 min at table so operators spot
          // long-runners without checking every tile.
          const timerColor = isServing
            ? elapsedMin >= 90 ? '#ef4444' : elapsedMin >= 60 ? '#f59e0b' : 'var(--text)'
            : isCalling ? '#eab308' : 'var(--text)';
          const isTransferTarget = transferFor && transferFor.id !== table.id && table.status === 'available';
          return (
            <div
              key={table.id}
              onClick={() => { if (isTransferTarget) transferTo(table); }}
              style={{
                ...tileStyle,
                borderColor: colors.border,
                background: colors.bg,
                cursor: isTransferTarget ? 'pointer' : 'default',
                boxShadow: isTransferTarget ? `0 0 0 3px ${colors.border}55` : 'none',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Calling banner — bold top strip so host spots it across the room */}
              {isCalling && (
                <div style={{
                  margin: '-12px -12px 8px -12px',
                  padding: '4px 10px',
                  background: CALLING_COLORS.border,
                  color: '#000',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span>📣 {t('calling')}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{elapsed ?? '—'}</span>
                </div>
              )}

              {/* Title row — code + timer (when serving) or small status dot */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{table.code}</span>
                {tk && isServing ? (
                  <span style={{
                    fontSize: 15, fontWeight: 800, color: timerColor,
                    fontVariantNumeric: 'tabular-nums', letterSpacing: 0.3,
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                  }} title={t('Elapsed')}>
                    ⏱ {elapsed ?? '—'}
                  </span>
                ) : (
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: colors.border,
                    boxShadow: `0 0 0 2px ${colors.bg}`,
                  }} title={t(table.status)} />
                )}
              </div>

              {/* Capacity + zone — promoted to readable text */}
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PeopleIcon size={14} /><strong style={{ color: 'var(--text)', fontSize: 14 }}>{table.capacity ?? '?'}</strong></span>
                {table.zone && (
                  <span style={{
                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                    background: 'var(--surface2)', color: 'var(--text3)',
                  }}>{table.zone}</span>
                )}
              </div>

              {tk && (
                <div style={seatedBox}>
                  {tk.customer_data?.name && (
                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tk.customer_data.name}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: tk.customer_data?.name ? 1 : 0 }}>
                    {tk.ticket_number}
                  </div>
                  {isServing && tk && (() => {
                    const rows = itemsByTicket.get(tk.id) ?? [];
                    if (rows.length === 0) return null;
                    const count = rows.reduce((s, r) => s + r.qty, 0);
                    const total = rows.reduce((s, r) => s + (r.price != null ? r.price * r.qty : 0), 0);
                    return (
                      <div style={{
                        marginTop: 4, fontSize: 11, color: 'var(--text2)',
                        display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
                      }}>
                        <span style={{
                          display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                          background: 'rgba(59,130,246,0.18)', color: '#93c5fd',
                          fontWeight: 700, fontSize: 10,
                        }}>🍽 {count}</span>
                        {total > 0 && (
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#86efac', fontWeight: 700 }}>
                            {fmtMoney(total)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Actions — state-driven */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto', paddingTop: 8 }}>
                {/* AVAILABLE: one-tap call-next when there's a queue */}
                {table.status === 'available' && waiting.length > 0 && !transferFor && (
                  <>
                    <button
                      onClick={() => setPickCustomerFor({ table, mode: 'call' })}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, background: '#eab308', color: '#000', flex: 1 }}
                      title={t('Pick a waiting party to call to this table')}
                    >
                      📢 {t('Call')}
                    </button>
                    <button
                      onClick={() => setPickCustomerFor({ table, mode: 'seat' })}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, background: '#16a34a', color: '#fff', flex: 1 }}
                      title={t('Pick a waiting party to seat at this table now')}
                    >
                      🪑 {t('Seat')}
                    </button>
                  </>
                )}

                {/* CALLING: confirm seated · no-show · cancel · transfer */}
                {isCalling && (
                  <>
                    <button
                      onClick={() => confirmSeated(table)}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, background: '#16a34a', color: '#fff' }}
                      title={t('Confirm the party has arrived and is seated')}
                    >
                      ✓ {t('Seated')}
                    </button>
                    <button
                      onClick={() => noShowAtTable(table)}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, background: '#64748b', color: '#fff' }}
                      title={t('Party did not arrive')}
                    >
                      🚷 {t('No-show')}
                    </button>
                    <button
                      onClick={() => setTransferFor(table)}
                      disabled={busy === table.id}
                      style={btnIcon}
                      title={t('Transfer to another table')}
                    >
                      🔀
                    </button>
                    <button
                      onClick={() => cancelAtTable(table)}
                      disabled={busy === table.id}
                      style={{ ...btnIcon, color: '#fca5a5' }}
                      title={t('Cancel ticket')}
                    >
                      ✕
                    </button>
                  </>
                )}

                {/* SERVING: complete · transfer. Cancel is intentionally
                    omitted — once a party is seated, the only valid exits
                    are Complete (normal end of visit) or Transfer (table
                    change). Cancelling mid-service would mis-state the
                    ticket history and the schema doesn't support it here
                    (no cancelled_at column on the serving path). */}
                {isServing && (
                  <>
                    <button
                      onClick={() => {
                        if (!orgId) {
                          void dialogAlert(t('Organization not loaded — sign in again to place orders.'));
                          return;
                        }
                        if (tk) setOrderPadFor({ ticket: tk, table });
                      }}
                      disabled={busy === table.id || !tk}
                      style={{ ...btnSmall, background: '#3b82f6', color: '#fff' }}
                      title={t('Add menu items to this ticket')}
                    >
                      🍽 {t('Menu')}
                    </button>
                    <button
                      onClick={() => completeAtTable(table)}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, background: '#16a34a', color: '#fff' }}
                    >
                      ✓ {t('Complete')}
                    </button>
                    <button
                      onClick={() => setTransferFor(table)}
                      disabled={busy === table.id}
                      style={btnIcon}
                      title={t('Transfer to another table')}
                    >
                      🔀
                    </button>
                  </>
                )}

                {/* OCCUPIED row with no attached ticket (stale) — safety valve */}
                {table.status === 'occupied' && !tk && (
                  <button
                    onClick={() => releaseTable(table)}
                    disabled={busy === table.id}
                    style={btnSmall}
                    title={t('Table is marked occupied but no ticket is attached')}
                  >
                    {t('Force clear')}
                  </button>
                )}

                {/* NON-ACTIVE states: cleaning / reserved / disabled */}
                {table.status !== 'available' && table.status !== 'occupied' && (
                  <button
                    onClick={() => releaseTable(table)}
                    disabled={busy === table.id}
                    style={btnSmall}
                  >
                    {t('Clear')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Waiting strip removed — the queue sidebar's WAITING section already
          shows the same data, so the floor-map bottom strip was redundant
          (and ate vertical space the table grid could use). The customer
          picker below still lists waiting parties when the operator taps
          Call/Seat on a tile, so no functionality is lost. */}

      {/* Customer picker — table-first flow. Operator tapped Call or Seat on
          an available tile; this modal lists every waiting ticket so they
          can pick any party (not just the next in line). Suggested tickets
          — those whose party size fits this table's capacity — are
          highlighted. */}
      {pickCustomerFor && createPortal(
        <div style={modalBackdrop} onClick={() => setPickCustomerFor(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {pickCustomerFor.mode === 'call'
                ? `📢 ${t('Call which party to {code}?', { code: pickCustomerFor.table.code })}`
                : `🪑 ${t('Seat which party at {code}?', { code: pickCustomerFor.table.code })}`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
              {pickCustomerFor.table.capacity
                ? t('Capacity: {n}', { n: pickCustomerFor.table.capacity })
                : ''}
            </div>
            {(() => {
              if (waiting.length === 0) {
                return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('No waiting parties to call.')}</div>;
              }
              const table = pickCustomerFor.table;
              const cap = table.capacity ?? 0;
              const minP = table.min_party_size ?? null;
              const maxP = table.max_party_size ?? null;
              // A ticket is "suggested" when its party size fits this specific table.
              const fitsThisTable = (tk: SeatedTicket) => {
                const n = parsePartySize(tk.customer_data?.party_size);
                if (n == null) return false;
                if (cap > 0 && n > cap) return false;
                if (minP != null && n < minP) return false;
                if (maxP != null && n > maxP) return false;
                return true;
              };
              const anyFits = waiting.some(fitsThisTable);
              const allFit = waiting.every(fitsThisTable);
              const distinguishes = anyFits && !allFit;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {waiting.map((tk) => {
                    const suggested = distinguishes && fitsThisTable(tk);
                    const doesNotFit = !fitsThisTable(tk) && parsePartySize(tk.customer_data?.party_size) != null;
                    const ps = parsePartySize(tk.customer_data?.party_size);
                    const waitElapsed = elapsedFromIso(tk.created_at ?? null);
                    return (
                      <button
                        key={tk.id}
                        onClick={async () => {
                          const picked = pickCustomerFor;
                          setPickCustomerFor(null);
                          if (picked.mode === 'call') {
                            await callTicketToTable(picked.table, tk.id);
                          } else {
                            await seatTicketAtTable(picked.table, tk.id);
                          }
                        }}
                        disabled={busy === table.id}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          border: suggested ? '2px solid #22c55e' : '1px solid var(--border)',
                          background: suggested ? 'rgba(34,197,94,0.12)' : 'var(--surface2)',
                          color: 'var(--text)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          opacity: doesNotFit ? 0.6 : 1,
                        }}
                        title={doesNotFit ? t('Party size does not fit this table') : undefined}
                      >
                        <div style={{ fontWeight: 800, fontSize: 15 }}>
                          {tk.customer_data?.name || tk.ticket_number}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          <span>{tk.ticket_number}</span>
                          {ps && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>· <PeopleIcon size={11} /> {ps}</span>}
                          {waitElapsed && <span>· ⏱ {waitElapsed}</span>}
                          {doesNotFit && <span style={{ color: '#fca5a5' }}>⚠</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={btnGhost} onClick={() => setPickCustomerFor(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Visit summary — fires after Complete. Shows the lifecycle
          timestamps and derived durations + a Print receipt button. */}
      <TicketCompletionSummaryModal
        summary={completionSummary ? {
          kind: 'dine_in',
          ticketNumber: completionSummary.ticketNumber,
          customerName: completionSummary.customerName,
          customerPhone: null,
          partySize: completionSummary.partySize,
          tableCode: completionSummary.tableCode,
          calledAt: completionSummary.calledAt,
          seatedAt: completionSummary.seatedAt,
          completedAt: completionSummary.completedAt,
          items: completionSummary.items.map((i) => ({
            id: i.id, name: i.name, qty: i.qty, price: i.price ?? null, note: i.note ?? null,
          })),
          itemsTotal: completionSummary.itemsTotal,
          payment: completionSummary.payment,
        } : null}
        locale={locale}
        currency={currency}
        decimals={decimals}
        orgName={null}
        staffName={null}
        onClose={() => setCompletionSummary(null)}
      />

      {/* OrderPad — menu + running order for the currently serving ticket */}
      {orderPadFor && orgId && (
        <OrderPad
          orgId={orgId}
          staffId={staffId}
          ticketId={orderPadFor.ticket.id}
          ticketNumber={orderPadFor.ticket.ticket_number}
          tableCode={orderPadFor.table.code}
          locale={locale}
          currency={currency}
          decimals={decimals}
          onClose={() => setOrderPadFor(null)}
          onChanged={loadTicketItems}
        />
      )}

      {/* PaymentModal — cash capture before final Complete. Runs the
          ticket→served transition in finalizeComplete on success. */}
      {payingFor && orgId && (
        <PaymentModal
          orgId={orgId}
          staffId={staffId}
          ticketId={payingFor.ticket.id}
          ticketNumber={payingFor.ticket.ticket_number}
          tableCode={payingFor.table.code}
          items={payingFor.items}
          locale={locale}
          currency={currency}
          decimals={decimals}
          onClose={() => setPayingFor(null)}
          onPaid={async (payment) => {
            const snap = payingFor;
            setPayingFor(null);
            await finalizeComplete(snap.table, snap.ticket, snap.items, snap.total, payment);
          }}
        />
      )}

      {showZReport && orgId && (
        <ZReportModal
          orgId={orgId}
          locale={locale}
          currency={currency}
          decimals={decimals}
          onClose={() => setShowZReport(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ color: 'var(--text2)' }}>{label}:</span>
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function elapsedFromIso(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
}

// Inline SVG people icon — the 👥 emoji renders as dim purple on Windows and
// vanishes in dark mode. This SVG inherits currentColor so it adapts to theme.
function PeopleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: '-2px' }} aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function minutesSinceIso(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

const tileStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '2px solid',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 200,
  transition: 'box-shadow 0.2s ease',
};

const seatedBox: React.CSSProperties = {
  background: 'var(--surface2)',
  borderRadius: 6,
  padding: 8,
  marginBottom: 4,
};

const occStrip: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  flexWrap: 'wrap',
};

const transferBanner: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(59,130,246,0.15)',
  border: '1px solid #3b82f6',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
};

const waitingStrip: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
};

const waitingChip: React.CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(168,85,247,0.14)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  alignItems: 'center',
  border: '1px solid rgba(168,85,247,0.45)',
};

const btnSmall: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--surface2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// Icon-only action buttons (transfer, cancel). Square footprint with a
// large glyph so the emoji/symbol actually reads at a glance. Kept
// compact so three actions fit on one row inside a 220px tile.
const btnIcon: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 8,
  background: 'var(--surface2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 34,
  minHeight: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btnGhost: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyWrap: React.CSSProperties = {
  textAlign: 'center',
  padding: 40,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalCard: React.CSSProperties = {
  width: 520,
  maxWidth: '92vw',
  maxHeight: '80vh',
  overflow: 'auto',
  padding: 16,
  borderRadius: 12,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
};
