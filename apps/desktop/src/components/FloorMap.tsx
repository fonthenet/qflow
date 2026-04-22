import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
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

export function FloorMap({ officeId, staffId, deskId, locale }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [tickets, setTickets] = useState<SeatedTicket[]>([]);
  const [waiting, setWaiting] = useState<SeatedTicket[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<RestaurantTable | null>(null);
  const [, tick] = useState(0);

  // 1 Hz ticker so seat timers refresh.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!officeId) return;
    try {
      await ensureAuth();
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
      const tableRows = (tr.data ?? []) as RestaurantTable[];
      const ticketRows = (wait.data ?? []) as SeatedTicket[];
      setTables(tableRows);
      const seatedIds = new Set(tableRows.filter((x) => x.current_ticket_id).map((x) => x.current_ticket_id!));
      setTickets(ticketRows.filter((x) => seatedIds.has(x.id)));
      setWaiting(ticketRows.filter((x) => x.status === 'waiting' && !seatedIds.has(x.id)));
    } catch { /* silent */ }
  }, [officeId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(load);
    return () => { unsub?.(); };
  }, [load]);

  const occupancy = useMemo(() => summarizeOccupancy(tables), [tables]);

  const seatTicket = async (tableId: string, ticketId: string) => {
    setBusy(tableId);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      // Make sure the ticket is in `serving` state + has the desk. If
      // the operator is managing from the map they may not have called
      // it yet; use a safe UPSERT-ish pattern.
      const updates: any = {};
      const nowIso = new Date().toISOString();
      updates.status = 'serving';
      updates.serving_started_at = nowIso;
      if (deskId) {
        updates.desk_id = deskId;
        updates.called_at = nowIso;
        updates.called_by_staff_id = staffId;
      }
      await sb.from('tickets').update(updates).eq('id', ticketId);
      await sb.from('restaurant_tables').update({
        status: 'occupied',
        current_ticket_id: ticketId,
        assigned_at: nowIso,
      }).eq('id', tableId);
      await load();
    } finally { setBusy(null); }
  };

  const seatNextWaiting = async (table: RestaurantTable) => {
    if (waiting.length === 0) return;
    const partyGuess = (t: SeatedTicket) => parsePartySize(t.customer_data?.party_size) ?? 2;
    // Prefer the first ticket whose party size fits this table.
    const best =
      waiting.find((tk) => {
        const n = partyGuess(tk);
        return (table.capacity ?? 0) >= n
          && (table.min_party_size == null || n >= table.min_party_size)
          && (table.max_party_size == null || n <= table.max_party_size);
      }) ?? waiting[0];
    await seatTicket(table.id, best.id);
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

  const completeAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    setBusy(table.id);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      // The trigger release_table_on_ticket_terminal auto-clears the
      // table when the ticket hits a terminal status.
      await sb.from('tickets').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', table.current_ticket_id);
      await load();
    } finally { setBusy(null); }
  };

  const cancelAtTable = async (table: RestaurantTable) => {
    if (!table.current_ticket_id) return;
    if (!confirm(t('Cancel ticket at {code}?', { code: table.code }))) return;
    setBusy(table.id);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('tickets').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }).eq('id', table.current_ticket_id);
      await load();
    } finally { setBusy(null); }
  };

  const transferTo = async (destination: RestaurantTable) => {
    if (!transferFor || !transferFor.current_ticket_id) return;
    setBusy(destination.id);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const ticketId = transferFor.current_ticket_id;
      const nowIso = new Date().toISOString();
      await sb.from('restaurant_tables').update({
        status: 'occupied', current_ticket_id: ticketId, assigned_at: nowIso,
      }).eq('id', destination.id);
      await sb.from('restaurant_tables').update({
        status: 'available', current_ticket_id: null, assigned_at: null,
      }).eq('id', transferFor.id);
      setTransferFor(null);
      await load();
    } finally { setBusy(null); }
  };

  if (!officeId) return null;
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
          const colors = STATUS_COLORS[table.status];
          const elapsed = table.status === 'occupied' ? elapsedFromIso(table.assigned_at) : null;
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
                }}>{t(table.status)}</span>
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
                    ⏱️ {elapsed ?? '—'}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {table.status === 'available' && waiting.length > 0 && !transferFor && (
                  <button
                    onClick={() => seatNextWaiting(table)}
                    disabled={busy === table.id}
                    style={{ ...btnSmall, background: '#22c55e', color: '#fff' }}
                  >
                    ▶ {t('Seat next')}
                  </button>
                )}
                {table.status === 'occupied' && (
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

      {/* Waiting strip at the bottom */}
      {waiting.length > 0 && (
        <div style={waitingStrip}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text3)', marginBottom: 6 }}>
            {t('Waiting')} ({waiting.length})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {waiting.slice(0, 12).map((tk) => {
              const ps = parsePartySize(tk.customer_data?.party_size);
              const fitCount = ps ? matchTablesForParty(tables, ps).length : 0;
              return (
                <div key={tk.id} style={waitingChip}>
                  <span style={{ fontWeight: 700 }}>{tk.ticket_number}</span>
                  {tk.customer_data?.name && <span style={{ opacity: 0.7 }}>· {tk.customer_data.name}</span>}
                  {ps && <span style={{ opacity: 0.7 }}>· 👥 {ps}</span>}
                  {ps && fitCount === 0 && <span title={t('No matching table')} style={{ color: '#fca5a5' }}>⚠</span>}
                </div>
              );
            })}
          </div>
        </div>
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
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--surface2)',
  color: 'var(--text)',
  fontSize: 12,
  alignItems: 'center',
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
