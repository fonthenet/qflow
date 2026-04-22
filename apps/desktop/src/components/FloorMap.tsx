import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { cloudFetch } from '../lib/cloud-fetch';
import { t as translate, type DesktopLocale } from '../lib/i18n';

const CLOUD_URL = 'https://qflo.net';
import {
  matchTablesForParty,
  parsePartySize,
  summarizeOccupancy,
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
}

interface SeatedTicket {
  id: string;
  ticket_number: string;
  customer_data: any;
  status: string;
  serving_started_at: string | null;
  called_at: string | null;
  created_at: string;
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

export function FloorMap({ officeId, staffId, deskId, locale }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [tickets, setTickets] = useState<SeatedTicket[]>([]);
  const [waiting, setWaiting] = useState<SeatedTicket[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<RestaurantTable | null>(null);
  const [callFor, setCallFor] = useState<SeatedTicket | null>(null);
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
  } | null>(null);
  const [, tick] = useState(0);

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
          .select('id, ticket_number, customer_data, status, serving_started_at, called_at, created_at')
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
      const ticketRows = (wait.data ?? []) as SeatedTicket[];
      setTables(tableRows);
      const seatedIds = new Set(tableRows.filter((x) => x.current_ticket_id).map((x) => x.current_ticket_id!));
      setTickets(ticketRows.filter((x) => seatedIds.has(x.id)));
      setWaiting(ticketRows.filter((x) => x.status === 'waiting' && !seatedIds.has(x.id)));
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
      alert(t('Not signed in — please log out and back in.'));
      throw new Error('ensureAuth returned empty token');
    }
    const sb = await getSupabase();
    const { error } = await sb.from('tickets').update(updates).eq('id', ticketId);
    if (error) {
      console.error('[FloorMap] ticket update failed', error, { ticketId, updates });
      alert(`${t('Update failed')}: ${error.message}`);
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

  const callToTable = async (table: RestaurantTable, ticketId: string) => {
    setBusy(table.id);
    try {
      const nowIso = new Date().toISOString();
      // waiting → called. In restaurant mode the ticket's desk_id MUST
      // stay NULL — the DB trigger check_desk_capacity rejects a second
      // called/serving ticket per desk, but one host stand legitimately
      // runs many tables concurrently. The ticket↔table binding lives in
      // restaurant_tables.current_ticket_id; audit still works via
      // called_by_staff_id. Pass the table code as deskName so the
      // customer's notification reads "please go to T3".
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
      await load();
    } finally { setBusy(null); }
  };

  const callNextWaiting = async (table: RestaurantTable) => {
    console.log('[FloorMap] Call next clicked', { table: table.code, waitingCount: waiting.length });
    if (waiting.length === 0) {
      alert(t('No waiting parties to call.'));
      return;
    }
    const partyGuess = (t: SeatedTicket) => parsePartySize(t.customer_data?.party_size) ?? 2;
    // Prefer the first ticket whose party size fits this table.
    const best =
      waiting.find((tk) => {
        const n = partyGuess(tk);
        return (table.capacity ?? 0) >= n
          && (table.min_party_size == null || n >= table.min_party_size)
          && (table.max_party_size == null || n <= table.max_party_size);
      }) ?? waiting[0];
    await callToTable(table, best.id);
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
    // Snapshot the ticket + table BEFORE the write so the post-complete
    // summary has all timestamps. Once the trigger frees the table row
    // and the ticket moves to 'served', we lose the binding.
    const tk = ticketFor(table.current_ticket_id);
    setBusy(table.id);
    try {
      const completedAt = new Date().toISOString();
      await writeTicket(table.current_ticket_id, {
        status: 'served',
        completed_at: completedAt,
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
        });
      }
      await load();
    } finally { setBusy(null); }
  };

  const cancelAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    if (!confirm(t('Cancel ticket at {code}?', { code: table.code }))) return;
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
    if (!confirm(t('Mark as no-show at {code}?', { code: table.code }))) return;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, height: '100%', overflow: 'auto' }}>
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
        </div>
      </div>

      {transferFor && (
        <div style={transferBanner}>
          <span>🔀 {t('Select a destination table for {code}', { code: transferFor.code })}</span>
          <button onClick={() => setTransferFor(null)} style={btnGhost}>{t('Cancel')}</button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {tables.map((table) => {
          const tk = ticketFor(table.current_ticket_id);
          const isCalling = tk?.status === 'called';
          const isServing = tk?.status === 'serving';
          const colors = isCalling ? CALLING_COLORS : STATUS_COLORS[table.status];
          const stateLabel = isCalling ? t('calling') : t(table.status);
          const elapsed = (isCalling || isServing) ? elapsedFromIso(isServing ? tk?.serving_started_at ?? table.assigned_at : tk?.called_at ?? table.assigned_at) : null;
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
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{table.code}</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  color: colors.label, background: colors.bg,
                  border: `1px solid ${colors.border}55`,
                  textTransform: 'uppercase', letterSpacing: 0.4,
                }}>{stateLabel}</span>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
                👥 {table.capacity ?? '?'}
                {table.zone && ` · ${table.zone}`}
              </div>

              {tk && (
                <div style={seatedBox}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{tk.ticket_number}</div>
                  {tk.customer_data?.name && (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{tk.customer_data.name}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    {isCalling ? '📣' : '⏱️'} {elapsed ?? '—'}
                  </div>
                </div>
              )}

              {/* Actions — state-driven */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {/* AVAILABLE: one-tap call-next when there's a queue */}
                {table.status === 'available' && waiting.length > 0 && !transferFor && (
                  <button
                    onClick={() => callNextWaiting(table)}
                    disabled={busy === table.id}
                    style={{ ...btnSmall, background: '#eab308', color: '#000' }}
                    title={t('Call next waiting party to this table')}
                  >
                    📣 {t('Call next')}
                  </button>
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
                      style={btnSmall}
                      title={t('Transfer to another table')}
                    >
                      🔀
                    </button>
                    <button
                      onClick={() => cancelAtTable(table)}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, color: '#fca5a5' }}
                      title={t('Cancel ticket')}
                    >
                      ✕
                    </button>
                  </>
                )}

                {/* SERVING: complete · transfer · cancel */}
                {isServing && (
                  <>
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
                      style={btnSmall}
                      title={t('Transfer to another table')}
                    >
                      🔀
                    </button>
                    <button
                      onClick={() => cancelAtTable(table)}
                      disabled={busy === table.id}
                      style={{ ...btnSmall, color: '#fca5a5' }}
                      title={t('Cancel ticket')}
                    >
                      ✕
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

      {/* Waiting strip at the bottom — each chip opens a table picker */}
      {waiting.length > 0 && (
        <div style={waitingStrip}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text3)', marginBottom: 6 }}>
            {t('Waiting')} ({waiting.length}) · {t('Click a party to call them to a specific table')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {waiting.slice(0, 12).map((tk) => {
              const ps = parsePartySize(tk.customer_data?.party_size);
              const fitCount = ps ? matchTablesForParty(tables, ps).length : 0;
              return (
                <button
                  key={tk.id}
                  onClick={() => { console.log('[FloorMap] waiting chip click', tk.ticket_number); setCallFor(tk); }}
                  style={{ ...waitingChip, cursor: 'pointer', border: '1px solid var(--border)' }}
                  title={t('Call this party to a table')}
                >
                  <span style={{ fontWeight: 700 }}>📣 {tk.ticket_number}</span>
                  {tk.customer_data?.name && <span style={{ opacity: 0.7 }}>· {tk.customer_data.name}</span>}
                  {ps && <span style={{ opacity: 0.7 }}>· 👥 {ps}</span>}
                  {ps && fitCount === 0 && <span title={t('No matching table')} style={{ color: '#fca5a5' }}>⚠</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Table picker modal — portaled to body to escape any parent
          overflow/stacking context in the Station layout. */}
      {callFor && createPortal(
        <div style={modalBackdrop} onClick={() => setCallFor(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              📣 {t('Call {ticket} to which table?', { ticket: callFor.ticket_number })}
            </div>
            {callFor.customer_data?.name && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>{callFor.customer_data.name}</div>
            )}
            {(() => {
              const ps = parsePartySize(callFor.customer_data?.party_size);
              const avail = tables.filter((x) => x.status === 'available');
              const suggestedIds = new Set(
                ps ? matchTablesForParty(avail, ps).filter((m) => m.fits).map((m) => m.table.id) : []
              );
              if (avail.length === 0) {
                return <div style={{ color: 'var(--text2)', fontSize: 13 }}>{t('No available tables right now.')}</div>;
              }
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {avail.map((tab) => {
                    const suggested = suggestedIds.has(tab.id);
                    return (
                      <button
                        key={tab.id}
                        onClick={async () => {
                          const tk = callFor;
                          setCallFor(null);
                          await callToTable(tab, tk.id);
                        }}
                        disabled={busy === tab.id}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          border: suggested ? '2px solid #22c55e' : '1px solid var(--border)',
                          background: suggested ? 'rgba(34,197,94,0.12)' : 'var(--surface2)',
                          color: 'var(--text)',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 16 }}>{tab.code} {suggested && '⭐'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                          👥 {tab.capacity ?? '?'}{tab.zone ? ` · ${tab.zone}` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={btnGhost} onClick={() => setCallFor(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Visit summary — fires after Complete. Shows the lifecycle
          timestamps and derived durations so the host has a record of
          the service before the table recycles. */}
      {completionSummary && createPortal(
        <div style={modalBackdrop} onClick={() => setCompletionSummary(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              ✓ {t('Visit complete')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
              {completionSummary.ticketNumber}{completionSummary.customerName ? ` · ${completionSummary.customerName}` : ''}
            </div>
            <SummaryRow label={t('Table')} value={completionSummary.tableCode} />
            {completionSummary.partySize != null && (
              <SummaryRow label={t('Party size')} value={`👥 ${completionSummary.partySize}`} />
            )}
            {completionSummary.calledAt && (
              <SummaryRow label={t('Called at')} value={formatTime(completionSummary.calledAt)} />
            )}
            {completionSummary.seatedAt && (
              <SummaryRow label={t('Seated at')} value={formatTime(completionSummary.seatedAt)} />
            )}
            <SummaryRow label={t('Completed at')} value={formatTime(completionSummary.completedAt)} />
            <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
            {completionSummary.calledAt && completionSummary.seatedAt && (
              <SummaryRow
                label={t('Waited before seating')}
                value={durationBetween(completionSummary.calledAt, completionSummary.seatedAt)}
                emphasis
              />
            )}
            {completionSummary.seatedAt && (
              <SummaryRow
                label={t('Time at table')}
                value={durationBetween(completionSummary.seatedAt, completionSummary.completedAt)}
                emphasis
              />
            )}
            {completionSummary.calledAt && (
              <SummaryRow
                label={t('Total visit duration')}
                value={durationBetween(completionSummary.calledAt, completionSummary.completedAt)}
                emphasis
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => setCompletionSummary(null)}
                style={{
                  padding: '8px 20px', borderRadius: 8,
                  background: '#16a34a', color: '#fff', border: 'none',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                {t('Done')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function SummaryRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0',
      fontSize: emphasis ? 14 : 13,
    }}>
      <span style={{ color: 'var(--text2)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: emphasis ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function durationBetween(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
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

const tileStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '2px solid',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 140,
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
  padding: '4px 8px',
  borderRadius: 6,
  background: 'var(--surface2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
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
