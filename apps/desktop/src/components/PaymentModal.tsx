import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import type { TicketItem } from './OrderPad';
import { buildReceiptHtml } from '../lib/receipt';
import { formatMoney, parseMoney, formatMoneyForInput, QUICK_ADD, labelForQuickAdd } from '../lib/money';

interface Printer {
  id: string;
  name: string;
  driver_name: string;
  width_mm: number;
  kind: string;
  is_default: 0 | 1;
  enabled: 0 | 1;
}

interface Props {
  orgId: string;
  staffId: string | null;
  staffName?: string | null;
  ticketId: string;
  ticketNumber: string;
  tableCode?: string | null;
  items: TicketItem[];
  orgName?: string | null;
  locale: DesktopLocale;
  currency?: string;
  decimals?: number;
  onClose: () => void;
  onPaid: (payment: { method: 'cash'; amount: number; tendered: number; change: number }) => void;
}

export function PaymentModal({
  orgId, staffId, staffName, ticketId, ticketNumber, tableCode,
  items, orgName, locale, currency = '', decimals = 2, onClose, onPaid,
}: Props) {
  const t = useCallback((k: string, v?: Record<string, any>) => translate(locale, k, v), [locale]);
  const total = useMemo(
    () => items.reduce((s, it) => s + ((it.price ?? 0) * it.qty), 0),
    [items]
  );
  const fmt = (n: number) => formatMoney(n, currency, decimals);

  // tendered is the raw string the operator is typing, in the org's
  // main currency unit. parseMoney converts it back to a number.
  const [tendered, setTendered] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [doPrint, setDoPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (window as any).qf?.printers?.list?.().then((rows: Printer[]) => {
      const arr = Array.isArray(rows) ? rows : [];
      const pick = arr.find((p) => p.is_default && p.enabled) ?? arr.find((p) => p.enabled) ?? null;
      setPrinter(pick);
      if (!pick) setDoPrint(false);
    }).catch(() => { setPrinter(null); setDoPrint(false); });
  }, []);

  const tenderedAmt = tendered === '' ? 0 : parseMoney(tendered);
  const change = Math.max(0, tenderedAmt - total);
  const short = tendered !== '' && tenderedAmt < total;

  const pay = async () => {
    setErr(null);
    if (total <= 0) { setErr(t('Nothing to charge — ticket has no priced items.')); return; }
    const amt = total;
    const tend = tendered === '' ? amt : tenderedAmt;
    if (tend < amt) { setErr(t('Tendered is less than total.')); return; }
    setBusy(true);
    try {
      await (window as any).qf.payments.create(orgId, ticketId, {
        method: 'cash',
        amount: amt,
        tendered: tend,
        change_given: Math.max(0, tend - amt),
        note: note.trim() || null,
        paid_by: staffId,
      });
      if (doPrint && printer) {
        try {
          const html = buildReceiptHtml({
            orgName: orgName ?? 'Qflo',
            ticketNumber,
            tableCode: tableCode ?? null,
            staffName: staffName ?? null,
            items: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price ?? 0 })),
            total: amt,
            tendered: tend,
            change: Math.max(0, tend - amt),
            currency,
            decimals,
            paidAt: new Date(),
            widthMm: printer.width_mm || 80,
            locale,
          });
          await (window as any).qf.receipts.print({
            driverName: printer.driver_name,
            html,
            widthMm: printer.width_mm || 80,
            silent: true,
          });
        } catch (printErr: any) {
          console.warn('[PaymentModal] print failed', printErr);
        }
      }
      onPaid({ method: 'cash', amount: amt, tendered: tend, change: Math.max(0, tend - amt) });
    } catch (e: any) {
      setErr(e?.message ?? 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div style={backdrop} onClick={onClose}>
      <div style={shell} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>
            {t('Payment')} · {ticketNumber}{tableCode ? ` · ${tableCode}` : ''}
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
            <div style={sectionTitle}>{t('Order')}</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
              {items.length === 0 && (
                <div style={{ padding: 16, color: 'var(--text3)', fontSize: 13 }}>{t('No items')}</div>
              )}
              {items.map((it) => {
                const line = (it.price ?? 0) * it.qty;
                return (
                  <div key={it.id} style={itemRow}>
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.qty}× {it.name}
                    </div>
                    <div style={{ fontWeight: 700 }}>{fmt(line)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 4px 0', fontSize: 20, fontWeight: 800 }}>
              <span>{t('Total')}</span>
              <span>{fmt(total)}</span>
            </div>
          </div>

          {/* Cash pad */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={sectionTitle}>{t('Cash received')}</div>
            <input
              autoFocus
              value={tendered}
              onChange={(e) => setTendered(e.target.value.replace(/[^0-9.,]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) pay(); }}
              placeholder={formatMoneyForInput(total, decimals)}
              style={{ ...inputStyle, fontSize: 24, fontWeight: 800, textAlign: 'right' }}
              inputMode="decimal"
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setTendered(formatMoneyForInput(total, decimals))} style={quickBtn}>{t('Exact')}</button>
              {QUICK_ADD.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    const base = tendered === '' ? 0 : tenderedAmt;
                    setTendered(formatMoneyForInput(base + n, decimals));
                  }}
                  style={quickBtn}
                >{labelForQuickAdd(n)}</button>
              ))}
              <button onClick={() => setTendered('')} style={{ ...quickBtn, marginLeft: 'auto', color: '#ef4444' }}>{t('Clear')}</button>
            </div>

            <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--text3)' }}>{t('Change')}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: short ? '#ef4444' : '#22c55e' }}>
                {short ? `- ${fmt(total - tenderedAmt)}` : fmt(change)}
              </span>
            </div>

            <label style={{ ...fieldLabel, marginTop: 6 }}>{t('Note — optional')}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('e.g. gift, tip, voucher…')}
              style={inputStyle}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <input
                id="pm-print"
                type="checkbox"
                checked={doPrint}
                onChange={(e) => setDoPrint(e.target.checked)}
                disabled={!printer}
              />
              <label htmlFor="pm-print" style={{ fontSize: 13, color: printer ? 'var(--text)' : 'var(--text3)' }}>
                {printer
                  ? t('Print receipt on {name}', { name: printer.name })
                  : t('No printer configured — set one in Settings → Printers.')}
              </label>
            </div>

            {err && <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
          </div>
        </div>

        <div style={footer}>
          <button onClick={onClose} style={ghostBtn} disabled={busy}>{t('Cancel')}</button>
          <button onClick={pay} style={primaryBtn} disabled={busy || total <= 0 || short}>
            {busy ? t('Processing…') : (doPrint && printer ? t('Pay & Print') : t('Pay'))}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

// ── Styles ────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9995,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const shell: React.CSSProperties = {
  width: '100%', maxWidth: 900, maxHeight: '90vh',
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
  background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 14,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text3)', fontWeight: 700,
};
const itemRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 10,
  padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 14,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: 14, colorScheme: 'light dark',
  boxSizing: 'border-box',
};
const fieldLabel: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'var(--text3)', fontWeight: 700,
};
const quickBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
  fontWeight: 700, fontSize: 13,
};
const footer: React.CSSProperties = {
  padding: '12px 20px', borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--surface)',
};
const ghostBtn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontWeight: 700,
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none',
  background: '#22c55e', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 14,
};
