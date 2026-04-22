import { useEffect, useState, useCallback, useMemo } from 'react';
import { t as translate, normalizeLocale, getDirection, type DesktopLocale } from '../lib/i18n';

interface Ticket {
  id: string;
  ticket_number: string;
  status: string;
  customer_name?: string | null;
  called_at?: string | null;
  serving_started_at?: string | null;
  created_at?: string;
  priority?: number;
  recall_count?: number;
}

interface MiniSession {
  office_id: string;
  desk_id?: string | null;
  staff_id: string;
}

const COLORS = {
  serving: '#22c55e',
  called: '#3b82f6',
  waiting: '#f59e0b',
  danger: '#ef4444',
  muted: '#64748b',
} as const;

export function MiniQueue() {
  const [session, setSession] = useState<MiniSession | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'error' | 'success' } | null>(null);
  const [, forceTick] = useState(0);
  const [locale, setLocale] = useState<DesktopLocale>('en');
  const t = useCallback(
    (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values),
    [locale],
  );

  useEffect(() => {
    (window as any).qf?.settings?.getLocale?.().then((v: string) => setLocale(normalizeLocale(v))).catch(() => {});
    const unsub = (window as any).qf?.settings?.onLocaleChange?.((v: string) => setLocale(normalizeLocale(v)));
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
  }, [locale]);

  // Elapsed-time ticker (1 Hz) so "2:43" on the serving/called cards
  // updates without a full re-fetch.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (window as any).qf?.session?.load?.().then((s: any) => {
      if (s?.office_id && s?.staff_id) {
        setSession({ office_id: s.office_id, desk_id: s.desk_id ?? null, staff_id: s.staff_id });
      }
    }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await (window as any).qf?.db?.getTickets?.([session.office_id], ['waiting', 'called', 'serving']);
      setTickets(Array.isArray(rows) ? rows : []);
    } catch {
      /* local-only read */
    }
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const unsub = (window as any).qf?.tickets?.onChange?.(refresh);
    return () => { unsub?.(); };
  }, [refresh]);

  const flash = (text: string, kind: 'info' | 'error' | 'success' = 'info') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 1800);
  };

  const withBusy = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const callNext = () => withBusy(async () => {
    if (!session?.desk_id) { flash(t('Open the main window to assign a desk'), 'error'); return; }
    try {
      const result = await (window as any).qf?.db?.callNext?.(session.office_id, session.desk_id, session.staff_id);
      if (!result) flash(t('Queue is empty'), 'info');
      else flash(t('Called {number}', { number: result.ticket_number ?? '' }), 'success');
    } catch (e: any) { flash(e?.message || t('Call failed'), 'error'); }
  });

  const callTicket = (tk: Ticket) => withBusy(async () => {
    if (!session?.desk_id) { flash(t('Open the main window to assign a desk'), 'error'); return; }
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        status: 'called',
        desk_id: session.desk_id,
        called_at: new Date().toISOString(),
        called_by_staff_id: session.staff_id,
      });
      flash(t('Called {number}', { number: tk.ticket_number }), 'success');
    } catch (e: any) { flash(e?.message || t('Call failed'), 'error'); }
  });

  const startServing = (tk: Ticket) => withBusy(async () => {
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        status: 'serving',
        serving_started_at: new Date().toISOString(),
      });
    } catch (e: any) { flash(e?.message || t('Update failed'), 'error'); }
  });

  const complete = (tk: Ticket) => withBusy(async () => {
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      flash(t('Completed {number}', { number: tk.ticket_number }), 'success');
    } catch (e: any) { flash(e?.message || t('Update failed'), 'error'); }
  });

  const noShow = (tk: Ticket) => withBusy(async () => {
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        status: 'no_show',
        completed_at: new Date().toISOString(),
      });
    } catch (e: any) { flash(e?.message || t('Update failed'), 'error'); }
  });

  const cancel = (tk: Ticket) => withBusy(async () => {
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch (e: any) { flash(e?.message || t('Cancel failed'), 'error'); }
  });

  const recall = (tk: Ticket) => withBusy(async () => {
    try {
      await (window as any).qf?.db?.updateTicket?.(tk.id, {
        recall_count: (tk.recall_count ?? 0) + 1,
        called_at: new Date().toISOString(),
      });
      flash(t('Recalled {number}', { number: tk.ticket_number }), 'success');
    } catch (e: any) { flash(e?.message || t('Recall failed'), 'error'); }
  });

  const openMain = () => (window as any).qf?.mini?.restoreMain?.();
  const hideMini = () => (window as any).qf?.mini?.hide?.();

  const { serving, called, waiting } = useMemo(() => {
    const s = tickets.filter((t) => t.status === 'serving');
    const c = tickets.filter((t) => t.status === 'called');
    const w = tickets
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => {
        const pa = a.priority ?? 0, pb = b.priority ?? 0;
        if (pa !== pb) return pb - pa;
        return (a.created_at ?? '').localeCompare(b.created_at ?? '');
      });
    return { serving: s, called: c, waiting: w };
  }, [tickets]);

  const nextTicket = waiting[0];

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'system-ui, sans-serif',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    >
      {/* Drag handle + title + open-full */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          WebkitAppRegion: 'drag',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        } as any}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.serving, display: 'inline-block' }} />
          {t('Mini Queue')}
          {!session?.desk_id && (
            <span style={{ fontSize: 10, color: COLORS.danger, fontWeight: 600, marginLeft: 4 }}>{t('No desk')}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={openMain}
            style={actionBtnStyle('var(--surface2)', { WebkitAppRegion: 'no-drag' } as any)}
            title={t('Open full Station')}
          >
            {t('Open')} ↗
          </button>
          <button
            onClick={hideMini}
            style={actionBtnStyle('var(--surface2)', { WebkitAppRegion: 'no-drag', minWidth: 24 } as any)}
            title={t('Hide mini queue')}
          >
            −
          </button>
        </div>
      </div>

      {/* Body — active work on top, waiting list + call-next at bottom */}
      <div style={{ padding: 12, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <TicketGroup
          label={t('Now serving')}
          accent={COLORS.serving}
          tickets={serving}
          renderMeta={(tk) => elapsedSince(tk.serving_started_at ?? tk.called_at)}
          actions={(tk) => (
            <>
              <ActionBtn color={COLORS.serving} label={`✓ ${t('Complete')}`} onClick={() => complete(tk)} />
              <ActionBtn color={COLORS.muted} label={t('No-show')} onClick={() => noShow(tk)} />
            </>
          )}
        />

        <TicketGroup
          label={t('Called')}
          accent={COLORS.called}
          tickets={called}
          renderMeta={(tk) => elapsedSince(tk.called_at)}
          actions={(tk) => (
            <>
              <ActionBtn color={COLORS.called} label={t('Start')} onClick={() => startServing(tk)} />
              <ActionBtn color={COLORS.muted} label={t('Recall')} onClick={() => recall(tk)} />
              <ActionBtn color={COLORS.danger} label="✕" onClick={() => cancel(tk)} title={t('Cancel')} />
            </>
          )}
        />

        {/* Divider pushes waiting + call-next to the bottom of the card */}
        <div style={{ flex: 1, minHeight: 8 }} />

        <div style={{ ...groupHeaderStyle, marginTop: 0 }}>
          <span>{t('Waiting')} ({waiting.length})</span>
        </div>
        {waiting.length === 0 ? (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.5 }}>{t('Queue is empty')}</div>
        ) : (
          waiting.slice(0, 6).map((tk) => (
            <div
              key={tk.id}
              style={{
                marginTop: 4,
                padding: '6px 8px',
                borderRadius: 8,
                background: 'var(--surface)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700, minWidth: 46 }}>{tk.ticket_number}</span>
              <span style={{ flex: 1, opacity: 0.7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tk.customer_name || ''}
              </span>
              <span style={{ fontSize: 10, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                {elapsedSince(tk.created_at)}
              </span>
              <ActionBtn color={COLORS.called} label={t('Call')} onClick={() => callTicket(tk)} compact />
              <ActionBtn color={COLORS.danger} label="✕" onClick={() => cancel(tk)} compact title={t('Cancel')} />
            </div>
          ))
        )}
        {waiting.length > 6 && (
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6, textAlign: 'center' }}>
            {t('+ {n} more — open full to see all', { n: waiting.length - 6 })}
          </div>
        )}

        {/* Call next — anchored at the bottom so it's always in reach */}
        <button
          onClick={callNext}
          disabled={busy || !session?.desk_id || !nextTicket}
          style={{
            width: '100%',
            padding: '12px',
            background: !nextTicket ? 'var(--surface2)' : COLORS.called,
            color: nextTicket ? '#fff' : 'var(--text)',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0.4,
            cursor: busy || !nextTicket ? 'default' : 'pointer',
            opacity: busy || !session?.desk_id ? 0.55 : 1,
            marginTop: 10,
          }}
        >
          {!nextTicket ? t('No one waiting') : `▶ ${t('Call next · {number}', { number: nextTicket.ticket_number })}`}
        </button>
      </div>

      {toast && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: 12,
          padding: '8px 12px', borderRadius: 8,
          background:
            toast.kind === 'error' ? 'rgba(239,68,68,0.95)' :
            toast.kind === 'success' ? 'rgba(34,197,94,0.95)' :
            'var(--surface2)',
          color: toast.kind === 'info' ? 'var(--text)' : '#fff',
          border: '1px solid var(--border)',
          fontSize: 12, textAlign: 'center', fontWeight: 600,
        }}>{toast.text}</div>
      )}
    </div>
  );
}

function TicketGroup({ label, accent, tickets, actions, renderMeta }: {
  label: string;
  accent: string;
  tickets: Ticket[];
  actions: (t: Ticket) => React.ReactNode;
  renderMeta?: (t: Ticket) => string;
}) {
  // Hide the section entirely when there's nothing to show — an empty
  // "Now serving" header was eating a third of the card for no signal.
  if (tickets.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={groupHeaderStyle}>
        <span>{label} ({tickets.length})</span>
      </div>
      {tickets.map((t) => (
          <div
            key={t.id}
            style={{
              marginTop: 4,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--surface2)',
              borderLeft: `3px solid ${accent}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.ticket_number}</span>
              <span style={{ flex: 1, opacity: 0.7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.customer_name || ''}
              </span>
              {renderMeta && (
                <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
                  {renderMeta(t)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>{actions(t)}</div>
          </div>
        ))}
    </div>
  );
}

function ActionBtn({ color, label, onClick, compact, title }: {
  color: string;
  label: string;
  onClick: () => void;
  compact?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flex: compact ? '0 0 auto' : 1,
        padding: compact ? '4px 8px' : '6px 10px',
        background: color,
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// Pick a legible foreground: solid brand colors get white, neutral
// theme surfaces (which change by theme) get the theme's text var.
function fgFor(bg: string): string {
  return bg.startsWith('var(') ? 'var(--text)' : '#fff';
}

function actionBtnStyle(bg: string, extra?: Record<string, any>) {
  return {
    background: bg,
    color: fgFor(bg),
    border: 'none',
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    ...extra,
  } as any;
}

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  opacity: 0.55,
  letterSpacing: 0.8,
  fontWeight: 700,
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 4,
};

function elapsedSince(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
}
