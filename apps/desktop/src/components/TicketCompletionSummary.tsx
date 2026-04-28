/**
 * TicketCompletionSummary — modal that recaps a completed ticket.
 *
 * Originally lived inline in FloorMap for dine-in visits. Extracted here
 * so the QueueOrdersCanvas (takeout / delivery completions) shows the
 * same recap. The component handles three "kinds":
 *   - dine_in : Table, Party size, Seated at, Time at table
 *   - takeout : no table/seating; shows "Order placed → Picked up" timing
 *   - delivery: no table/seating; shows "Order placed → Out / Delivered"
 *
 * Theme: CSS vars only. Closes on backdrop click + Esc.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { buildReceiptHtml } from '../lib/receipt';

export type CompletionKind = 'dine_in' | 'takeout' | 'delivery';

export interface CompletionSummaryItem {
  id: string;
  name: string;
  qty: number;
  price: number | null;
  note: string | null;
}

export interface CompletionSummaryData {
  kind: CompletionKind;
  ticketNumber: string;
  customerName: string | null;
  customerPhone?: string | null;
  partySize: number | null;            // dine_in only
  tableCode: string | null;            // dine_in only
  calledAt: string | null;
  seatedAt: string | null;             // dine_in only
  completedAt: string;
  items: CompletionSummaryItem[];
  itemsTotal: number;
  payment: { method: 'cash'; amount: number; tendered: number; change: number } | null;
}

export interface TicketCompletionSummaryModalProps {
  summary: CompletionSummaryData | null;
  locale: DesktopLocale;
  currency: string;
  decimals: number;
  /** Business name printed at the top of the receipt. */
  orgName?: string | null;
  /** Operator name printed under "Served by" on the receipt. */
  staffName?: string | null;
  onClose: () => void;
}

export function TicketCompletionSummaryModal({
  summary, locale, currency, decimals, orgName, staffName, onClose,
}: TicketCompletionSummaryModalProps) {
  const t = (key: string, vals?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, vals);
  const fmtMoney = (n: number) => `${currency}${n.toFixed(decimals)}`;
  const [printing, setPrinting] = useState(false);

  // Standards-compliant thermal receipt printing (58/80 mm). Uses the
  // shared buildReceiptHtml so this matches PaymentModal's print exactly.
  // Falls back to a popup with window.print() if no driver is configured.
  const printReceipt = async () => {
    if (!summary || printing) return;
    setPrinting(true);
    try {
      // Try the configured thermal printer first.
      const printers: any[] = await (window as any).qf?.printers?.list?.() ?? [];
      const printer = printers.find((p) => p.is_default && p.enabled)
        ?? printers.find((p) => p.enabled);
      const widthMm = printer?.width_mm || 80;
      const html = buildReceiptHtml({
        orgName: orgName ?? 'Qflo',
        ticketNumber: summary.ticketNumber,
        tableCode: summary.tableCode,
        staffName: staffName ?? null,
        items: summary.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price ?? 0 })),
        total: summary.itemsTotal,
        tendered: summary.payment?.tendered ?? summary.itemsTotal,
        change: summary.payment?.change ?? 0,
        currency,
        decimals,
        paidAt: new Date(summary.completedAt),
        widthMm,
        locale,
      });

      if (printer) {
        await (window as any).qf.receipts.print({
          driverName: printer.driver_name,
          html,
          widthMm,
          silent: true,
        });
      } else {
        // Fallback: popup window with system print dialog.
        const win = window.open('', '_blank', 'width=360,height=640');
        if (win) {
          win.document.write(html);
          win.document.close();
          setTimeout(() => { try { win.print(); } catch {} }, 250);
        }
      }
    } catch (err) {
      console.warn('[TicketCompletionSummary] print failed', err);
    } finally {
      setPrinting(false);
    }
  };

  // Esc closes
  useEffect(() => {
    if (!summary) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [summary, onClose]);

  if (!summary) return null;

  const isDineIn  = summary.kind === 'dine_in';
  const isTakeout = summary.kind === 'takeout';
  const kindLabel = isDineIn ? t('Dine in') : isTakeout ? t('Takeout') : t('Delivery');

  return createPortal(
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          ✓ {isDineIn ? t('Visit complete') : t('Order complete')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>
          {summary.ticketNumber}{summary.customerName ? ` · ${summary.customerName}` : ''}
        </div>

        {isDineIn && summary.tableCode && (
          <SummaryRow label={t('Table')} value={summary.tableCode} />
        )}
        {!isDineIn && (
          <SummaryRow label={t('Type')} value={kindLabel} />
        )}
        {isDineIn && summary.partySize != null && (
          <SummaryRow label={t('Party size')} value={`👥 ${summary.partySize}`} />
        )}
        {!isDineIn && summary.customerPhone && (
          <SummaryRow label={t('Phone')} value={summary.customerPhone} />
        )}
        {summary.calledAt && (
          <SummaryRow
            label={isDineIn ? t('Called at') : t('Order placed')}
            value={formatTime(summary.calledAt)}
          />
        )}
        {isDineIn && summary.seatedAt && (
          <SummaryRow label={t('Seated at')} value={formatTime(summary.seatedAt)} />
        )}
        <SummaryRow
          label={isDineIn ? t('Completed at') : isTakeout ? t('Picked up at') : t('Delivered at')}
          value={formatTime(summary.completedAt)}
        />

        {summary.items.length > 0 && (
          <>
            <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: 0.5, color: 'var(--text3)', marginBottom: 6,
            }}>
              🍽 {t('Served')} ({summary.items.reduce((s, i) => s + i.qty, 0)})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
              {summary.items.map((i) => (
                <div key={i.id} style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8,
                }}>
                  <span style={{
                    color: 'var(--text)', flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    <strong>{i.qty}×</strong> {i.name}
                    {i.note && <span style={{ color: '#fbbf24', fontStyle: 'italic' }}> · {i.note}</span>}
                  </span>
                  {i.price != null && (
                    <span style={{ color: 'var(--text2)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(i.price * i.qty)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {summary.itemsTotal > 0 && (
              <SummaryRow label={t('Items total')} value={fmtMoney(summary.itemsTotal)} emphasis />
            )}
            {summary.payment && (
              <>
                <SummaryRow
                  label={t('Cash received')}
                  value={fmtMoney(summary.payment.tendered)}
                />
                {summary.payment.change > 0 && (
                  <SummaryRow
                    label={t('Change')}
                    value={fmtMoney(summary.payment.change)}
                  />
                )}
              </>
            )}
          </>
        )}

        <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
        {isDineIn && summary.calledAt && summary.seatedAt && (
          <SummaryRow
            label={t('Waited before seating')}
            value={durationBetween(summary.calledAt, summary.seatedAt)}
            emphasis
          />
        )}
        {isDineIn && summary.seatedAt && (
          <SummaryRow
            label={t('Time at table')}
            value={durationBetween(summary.seatedAt, summary.completedAt)}
            emphasis
          />
        )}
        {!isDineIn && summary.calledAt && (
          <SummaryRow
            label={isTakeout ? t('Time to pickup') : t('Time to deliver')}
            value={durationBetween(summary.calledAt, summary.completedAt)}
            emphasis
          />
        )}
        {summary.calledAt && (
          <SummaryRow
            label={isDineIn ? t('Total visit duration') : t('Total order duration')}
            value={durationBetween(summary.calledAt, summary.completedAt)}
            emphasis
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={printReceipt}
            disabled={printing}
            style={{
              padding: '8px 16px', borderRadius: 8,
              background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)',
              fontWeight: 700, fontSize: 13,
              cursor: printing ? 'wait' : 'pointer',
              opacity: printing ? 0.6 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
            title={t('Print receipt')}
          >
            🖨 {printing ? t('Printing...') : t('Print receipt')}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 8,
              background: 'var(--success, #16a34a)', color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t('Done')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
function SummaryRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0',
      fontSize: emphasis ? 14 : 13,
    }}>
      <span style={{ color: 'var(--text2)' }}>{label}</span>
      <span style={{
        color: 'var(--text)', fontWeight: emphasis ? 800 : 600,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
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

const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10000,
};

const modalCard: React.CSSProperties = {
  width: 520, maxWidth: '92vw', maxHeight: '80vh',
  overflow: 'auto', padding: 16, borderRadius: 12,
  background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text)',
  boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
};
