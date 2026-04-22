import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import {
  matchTablesForParty,
  parsePartySize,
  type RestaurantTable,
} from '@qflo/shared';

// ── Smart table suggestion for an active ticket ───────────────────
// Shows up on the Station desk panel when:
//   • the org is restaurant/cafe
//   • the active ticket's customer_data carries a party_size
//   • at least one `available` table fits the party
// Offers top match + fallbacks with one-click seat. If the ticket is
// already seated, shows that instead with a Clear button.

interface Props {
  officeId: string | null;
  category: string;
  ticket: {
    id: string;
    ticket_number?: string;
    customer_data?: any;
  } | null;
  locale: DesktopLocale;
}

export function TableSuggestionBar({ officeId, category, ticket, locale }: Props) {
  const t = useCallback((k: string, vars?: Record<string, any>) => translate(locale, k, vars), [locale]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isRestaurantish = category === 'restaurant' || category === 'cafe';

  const load = useCallback(async () => {
    if (!officeId || !isRestaurantish) return;
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { data } = await sb
        .from('restaurant_tables')
        .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
        .eq('office_id', officeId);
      setTables((data ?? []) as RestaurantTable[]);
    } catch { /* silent — suggestion is advisory */ }
  }, [officeId, isRestaurantish]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(load);
    return () => { unsub?.(); };
  }, [load]);

  const partySize = useMemo(() => parsePartySize(ticket?.customer_data?.party_size), [ticket?.customer_data?.party_size]);
  const currentSeating = useMemo(
    () => (ticket ? tables.find((t) => t.current_ticket_id === ticket.id) : null),
    [tables, ticket],
  );
  const matches = useMemo(
    () => (partySize ? matchTablesForParty(tables, partySize) : []),
    [tables, partySize],
  );

  if (!isRestaurantish || !ticket) return null;
  // If no party_size AND not already seated, stay out of the way.
  if (!partySize && !currentSeating) return null;

  const seat = async (table: RestaurantTable) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error: e } = await sb
        .from('restaurant_tables')
        .update({
          status: 'occupied',
          current_ticket_id: ticket.id,
          assigned_at: new Date().toISOString(),
        })
        .eq('id', table.id);
      if (e) throw e;
      await load();
    } catch (e: any) { setErr(e?.message ?? 'Seat failed'); }
    finally { setBusy(false); }
  };

  const clearSeat = async () => {
    if (!currentSeating || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error: e } = await sb
        .from('restaurant_tables')
        .update({ status: 'available', current_ticket_id: null, assigned_at: null })
        .eq('id', currentSeating.id);
      if (e) throw e;
      await load();
    } catch (e: any) { setErr(e?.message ?? 'Clear failed'); }
    finally { setBusy(false); }
  };

  // Already seated branch
  if (currentSeating) {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 16 }}>🪑</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            {t('Seated at {code}', { code: currentSeating.code })} · {currentSeating.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {t('Party of {n}', { n: partySize ?? '?' })}
            {currentSeating.zone && ` · ${currentSeating.zone}`}
            {currentSeating.capacity && ` · 👥 ${currentSeating.capacity}`}
          </div>
        </div>
        <button onClick={clearSeat} disabled={busy} style={btnGhost} title={t('Release table')}>
          ✕ {t('Release')}
        </button>
      </div>
    );
  }

  // Suggestion branch
  const top = matches[0];
  const more = matches.slice(1, 4);

  if (!top) {
    return (
      <div style={{ ...wrap, borderColor: 'rgba(239,68,68,0.35)' }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            {t('Party of {n} — no table fits', { n: partySize })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {t('Clear a table or add more capacity in Business Administration.')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <span style={{ fontSize: 16 }}>💡</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
          {t('Suggested: {code}', { code: top.table.code })} · {top.table.label}
          {top.score === 0 && <span style={{ marginInlineStart: 6, color: '#22c55e', fontSize: 11 }}>✓ {t('perfect fit')}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
          {t('Party of {n}', { n: partySize })}
          {top.table.capacity && ` · 👥 ${top.table.capacity}`}
          {top.table.zone && ` · ${top.table.zone}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={() => seat(top.table)} disabled={busy} style={btnPrimary}>
          🪑 {t('Seat at {code}', { code: top.table.code })}
        </button>
        {more.map((m) => (
          <button key={m.table.id} onClick={() => seat(m.table)} disabled={busy} style={btnGhost} title={t('Seat at {code}', { code: m.table.code })}>
            {m.table.code}
          </button>
        ))}
      </div>
      {err && <div style={{ width: '100%', color: '#fca5a5', fontSize: 11, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  marginBottom: 10,
  flexWrap: 'wrap',
};

const btnPrimary: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  background: 'var(--primary)',
  color: '#fff',
  border: 'none',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
