import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import {
  matchTablesForParty,
  parsePartySize,
  type RestaurantTable,
} from '@qflo/shared';

// ── WaitingTicketActions ──────────────────────────────────────────
// Restaurant/cafe only. Renders two buttons on a waiting-queue row:
//   📣 Call — transitions waiting → called and binds ticket to the
//             picked table. Tile on floor map goes yellow "calling".
//   🪑 Seat — transitions waiting → serving in one step and binds
//             ticket to the picked table. Use when the party is
//             already standing at the host stand.
// Both open a table picker with the smart suggestion highlighted.

interface Props {
  ticketId: string;
  partySize: number | null;
  officeId: string | null;
  staffId: string | null;
  deskId: string | null;
  locale: DesktopLocale;
}

type Mode = 'call' | 'seat';

export function WaitingTicketActions({ ticketId, partySize, officeId, staffId, deskId, locale }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [busy, setBusy] = useState(false);

  // Load tables when the picker opens — cheap, keeps the modal fresh
  // if other staff seated/freed something in the last few seconds.
  useEffect(() => {
    if (!mode || !officeId) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data } = await sb
          .from('restaurant_tables')
          .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
          .eq('office_id', officeId)
          .eq('status', 'available')
          .order('code');
        if (!cancelled) setTables((data ?? []) as RestaurantTable[]);
      } catch { /* silent — modal shows empty state */ }
    })();
    return () => { cancelled = true; };
  }, [mode, officeId]);

  const applyAction = async (tableId: string) => {
    if (!mode) return;
    console.log('[WaitingTicketActions] applyAction', { mode, ticketId, tableId });
    setBusy(true);
    try {
      const token = await ensureAuth();
      if (!token) {
        alert(t('Not signed in — please log out and back in.'));
        return;
      }
      const sb = await getSupabase();
      const nowIso = new Date().toISOString();

      // Ticket: waiting → called (or serving for direct-seat).
      // desk_id MUST stay NULL in restaurant mode — see FloorMap.writeTicket
      // for the full explanation. The DB trigger check_desk_capacity
      // rejects a second active ticket per desk, but one host stand runs
      // many tables. Binding lives in restaurant_tables.current_ticket_id.
      const ticketUpdates: Record<string, any> =
        mode === 'call'
          ? { status: 'called', desk_id: null, called_at: nowIso, called_by_staff_id: staffId }
          : { status: 'serving', desk_id: null, called_at: nowIso, called_by_staff_id: staffId, serving_started_at: nowIso };

      const { error: tkErr } = await sb.from('tickets').update(ticketUpdates).eq('id', ticketId);
      if (tkErr) {
        console.error('[WaitingTicketActions] ticket update failed', tkErr);
        alert(`${t('Update failed')}: ${tkErr.message}`);
        throw tkErr;
      }

      // Table binding — mark occupied with the ticket bound.
      const { error: tbErr } = await sb.from('restaurant_tables').update({
        status: 'occupied', current_ticket_id: ticketId, assigned_at: nowIso,
      }).eq('id', tableId);
      if (tbErr) {
        console.error('[WaitingTicketActions] table update failed', tbErr);
        alert(`${t('Update failed')}: ${tbErr.message}`);
        throw tbErr;
      }

      // Fire-and-forget IPC so local SQLite + notification pipeline
      // mirror the change. Pass the table code as deskName so the
      // notification template renders "please go to T3" instead of "?".
      const tableCode = tables.find((x) => x.id === tableId)?.code;
      try {
        await (window as any).qf?.db?.updateTicket?.(
          ticketId,
          ticketUpdates,
          tableCode ? { deskName: tableCode } : undefined,
        );
      } catch { /* non-fatal */ }

      setMode(null);
    } catch (err) {
      console.error('[WaitingTicketActions] applyAction threw', err);
    }
    finally { setBusy(false); }
  };

  const suggestedIds = new Set(
    partySize ? matchTablesForParty(tables, partySize).filter((m) => m.fits).map((m) => m.table.id) : []
  );

  return (
    <>
      <button
        className="btn-sm"
        onClick={(e) => { e.stopPropagation(); setMode('call'); }}
        title={t('Call this party to a table')}
        style={callBtn}
      >
        📣 {t('Call')}
      </button>
      <button
        className="btn-sm"
        onClick={(e) => { e.stopPropagation(); setMode('seat'); }}
        title={t('Seat this party at a table now')}
        style={seatBtn}
      >
        🪑 {t('Seat')}
      </button>

      {mode && createPortal(
        <div style={modalBackdrop} onClick={() => setMode(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
              {mode === 'call'
                ? `📣 ${t('Call to which table?')}`
                : `🪑 ${t('Seat at which table?')}`}
            </div>
            {tables.length === 0 ? (
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                {t('No available tables right now.')}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {tables.map((tab) => {
                  const suggested = suggestedIds.has(tab.id);
                  return (
                    <button
                      key={tab.id}
                      onClick={() => applyAction(tab.id)}
                      disabled={busy}
                      style={{
                        padding: 10,
                        borderRadius: 8,
                        border: suggested ? '2px solid #22c55e' : '1px solid var(--border)',
                        background: suggested ? 'rgba(34,197,94,0.12)' : 'var(--surface2)',
                        color: 'var(--text)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        opacity: busy ? 0.6 : 1,
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
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setMode(null)} style={btnGhost}>{t('Close')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const callBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  background: '#eab308',
  color: '#000',
  border: 'none',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const seatBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
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

const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
