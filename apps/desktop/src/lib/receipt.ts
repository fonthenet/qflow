import { t as translate, type DesktopLocale } from './i18n';
import { formatMoney } from './money';

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
}

export interface ReceiptArgs {
  orgName: string;
  ticketNumber: string;
  tableCode: string | null;
  staffName: string | null;
  items: ReceiptItem[];
  total: number;
  tendered: number;
  change: number;
  currency: string;
  decimals?: number;
  paidAt: Date;
  widthMm: number;
  locale: DesktopLocale;
}

// HTML receipt designed for 58mm / 80mm thermal printers. Uses a fixed-width
// monospace layout so line breaks stay predictable under any driver. Printed
// via Electron webContents.print → the OS driver handles cutting/feeding.
export function buildReceiptHtml(args: ReceiptArgs): string {
  const { orgName, ticketNumber, tableCode, staffName, items, total, tendered, change, currency, decimals = 2, paidAt, widthMm, locale } = args;
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const fmt = (n: number) => formatMoney(n, currency, decimals);
  const cols = widthMm >= 80 ? 42 : 32;

  const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
  const dash = '-'.repeat(cols);

  const dateStr = paidAt.toLocaleString(
    locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-US',
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  );

  const itemLines = items.map((it) => {
    const line = it.price * it.qty;
    const right = ` ${fmt(line)}`;
    const leftMax = cols - right.length;
    const left = `${it.qty}x ${it.name}`;
    if (left.length <= leftMax) return pad(left, leftMax) + right;
    // wrap long names onto next line, price on first line
    const first = pad(left.slice(0, leftMax), leftMax) + right;
    const rest = left.slice(leftMax).match(new RegExp(`.{1,${cols}}`, 'g')) ?? [];
    return [first, ...rest].join('\n');
  }).join('\n');

  const row = (label: string, value: string) => {
    const right = value;
    const leftMax = cols - right.length;
    return pad(label, leftMax) + right;
  };

  const text =
`${centered(orgName, cols)}
${centered(t('Receipt'), cols)}
${dash}
${row(t('Ticket'), ticketNumber)}
${tableCode ? row(t('Table'), tableCode) + '\n' : ''}${staffName ? row(t('Served by'), staffName) + '\n' : ''}${row(t('Date'), dateStr)}
${dash}
${itemLines || ''}
${dash}
${row(t('Total'), fmt(total))}
${row(t('Cash'), fmt(tendered))}
${row(t('Change'), fmt(change))}
${dash}
${centered(t('Thank you!'), cols)}
`;

  const paddingMm = widthMm >= 80 ? 3 : 2;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt ${ticketNumber}</title>
<style>
  @page { margin: 0; size: ${widthMm}mm auto; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { padding: ${paddingMm}mm; }
  pre { margin: 0; font-family: 'Consolas','Courier New',monospace; font-size: ${widthMm >= 80 ? 11 : 10}pt; line-height: 1.25; white-space: pre; }
</style>
</head><body><pre>${escape(text)}</pre></body></html>`;
}

function centered(s: string, cols: number): string {
  if (s.length >= cols) return s.slice(0, cols);
  const pad = Math.floor((cols - s.length) / 2);
  return ' '.repeat(pad) + s;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

