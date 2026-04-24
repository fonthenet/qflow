import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { formatMoney } from '../lib/money';

interface Props {
  orgId: string;
  locale: DesktopLocale;
  currency?: string;
  decimals?: number;
  onClose: () => void;
}

interface ZReport {
  day: string;
  totalRevenue: number;
  txCount: number;
  byMethod: Record<string, { count: number; amount: number }>;
  byCategory: Record<string, { name: string; qty: number; amount: number }>;
  byStaff: Record<string, { name: string; count: number; amount: number }>;
  byHour: Record<string, { count: number; amount: number }>;
  payments: Array<{
    id: string; ticket_id: string; ticket_number: string | null; method: string;
    amount: number; tendered: number | null; change_given: number | null;
    paid_at: string; paid_by: string | null; staff_name: string | null;
  }>;
}

function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ZReportModal({ orgId, locale, currency = '', decimals = 2, onClose }: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const [day, setDay] = useState(todayLocal());
  const [report, setReport] = useState<ZReport | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (n: number) => formatMoney(n, currency, decimals);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await (window as any).qf?.reports?.zReport?.(orgId, day);
      setReport(r ?? null);
    } finally { setLoading(false); }
  }, [orgId, day]);
  useEffect(() => { load(); }, [load]);

  const hours = useMemo(() => {
    if (!report) return [] as Array<{ h: string; count: number; amount: number }>;
    return Object.entries(report.byHour)
      .map(([h, v]) => ({ h, ...v }))
      .sort((a, b) => a.h.localeCompare(b.h));
  }, [report]);

  const printReport = () => {
    window.print();
  };

  const body = (
    <div style={backdrop} onClick={onClose}>
      <div style={shell} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>📊 {t('Daily Z-Report')}</div>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} style={ghostBtn}>{t('Refresh')}</button>
            <button onClick={printReport} style={ghostBtn}>{t('Print')}</button>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {loading && <div style={{ color: 'var(--text3)' }}>{t('Loading…')}</div>}
          {!loading && report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Headline */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <Stat label={t('Total revenue')} value={fmt(report.totalRevenue)} accent="#22c55e" />
                <Stat label={t('Transactions')} value={String(report.txCount)} />
                <Stat label={t('Avg ticket')} value={report.txCount ? fmt(report.totalRevenue / report.txCount) : '—'} />
              </div>

              {/* By method */}
              <Section title={t('By payment method')}>
                <Table>
                  <THead cols={[t('Method'), t('Count'), t('Amount')]} />
                  {Object.entries(report.byMethod).map(([m, v]) => (
                    <TRow key={m} cells={[m.toUpperCase(), String(v.count), fmt(v.amount)]} />
                  ))}
                  {Object.keys(report.byMethod).length === 0 && <Empty />}
                </Table>
              </Section>

              {/* By category */}
              <Section title={t('By category')}>
                <Table>
                  <THead cols={[t('Category'), t('Qty'), t('Amount')]} />
                  {Object.values(report.byCategory)
                    .sort((a, b) => b.amount - a.amount)
                    .map((c, i) => (
                      <TRow key={i} cells={[c.name, String(c.qty), fmt(c.amount)]} />
                    ))}
                  {Object.keys(report.byCategory).length === 0 && <Empty />}
                </Table>
              </Section>

              {/* By staff */}
              <Section title={t('By staff')}>
                <Table>
                  <THead cols={[t('Staff'), t('Tickets'), t('Amount')]} />
                  {Object.values(report.byStaff)
                    .sort((a, b) => b.amount - a.amount)
                    .map((s, i) => (
                      <TRow key={i} cells={[s.name, String(s.count), fmt(s.amount)]} />
                    ))}
                  {Object.keys(report.byStaff).length === 0 && <Empty />}
                </Table>
              </Section>

              {/* By hour */}
              <Section title={t('By hour')}>
                <Table>
                  <THead cols={[t('Hour'), t('Count'), t('Amount')]} />
                  {hours.map((h) => (
                    <TRow key={h.h} cells={[`${h.h}:00`, String(h.count), fmt(h.amount)]} />
                  ))}
                  {hours.length === 0 && <Empty />}
                </Table>
              </Section>

              {/* Transactions */}
              <Section title={t('Transactions ({count})', { count: report.payments.length })}>
                <Table>
                  <THead cols={[t('Time'), t('Ticket'), t('Staff'), t('Method'), t('Amount')]} />
                  {report.payments.map((p) => (
                    <TRow
                      key={p.id}
                      cells={[
                        new Date(p.paid_at).toLocaleTimeString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
                        p.ticket_number ?? '—',
                        p.staff_name ?? '—',
                        p.method.toUpperCase(),
                        fmt(p.amount),
                      ]}
                    />
                  ))}
                  {report.payments.length === 0 && <Empty />}
                </Table>
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

// ── Subcomponents ─────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? 'var(--text)', marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>{title}</div>
      {children}
    </div>
  );
}
function Table({ children }: { children: React.ReactNode }) {
  return <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>{children}</div>;
}
function THead({ cols }: { cols: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols.map(() => '1fr').join(' '), background: 'var(--surface)', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {cols.map((c, i) => <div key={i} style={{ textAlign: i === cols.length - 1 ? 'right' : 'left' }}>{c}</div>)}
    </div>
  );
}
function TRow({ cells }: { cells: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cells.map(() => '1fr').join(' '), padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
      {cells.map((c, i) => <div key={i} style={{ textAlign: i === cells.length - 1 ? 'right' : 'left', fontWeight: i === cells.length - 1 ? 700 : 400 }}>{c}</div>)}
    </div>
  );
}
function Empty() {
  return <div style={{ padding: 12, color: 'var(--text3)', fontSize: 12, borderTop: '1px solid var(--border)' }}>—</div>;
}

// ── Styles ────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9990,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const shell: React.CSSProperties = {
  width: '100%', maxWidth: 1100, height: '90vh',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
};
const header: React.CSSProperties = {
  padding: '14px 20px', borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  background: 'var(--surface)',
};
const closeBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13,
  colorScheme: 'light dark',
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
  fontWeight: 600, fontSize: 13,
};
