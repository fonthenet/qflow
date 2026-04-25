/**
 * Plain-text receipt formatter for WhatsApp / Messenger / push.
 *
 * Mirrors the Station's `apps/desktop/src/lib/receipt.ts` thermal-printer
 * receipt — same fields, same locale rules, same money formatting — but
 * rendered as a single message body suitable for chat channels.
 *
 * IMPORTANT — Algerian currency rule (project memory): always render with
 * 2 decimals (DA + centimes). Never strip trailing `.00`. The shared
 * `formatMoney` helper enforces this.
 */

export type ReceiptLocale = 'en' | 'fr' | 'ar';

export interface ReceiptArgs {
  orgName: string;
  ticketNumber: string;
  tableCode?: string | null;
  staffName?: string | null;
  items: Array<{ name: string; qty: number; price: number | null }>;
  total: number;
  method: string;
  tendered?: number | null;
  change?: number | null;
  currency: string;
  decimals?: number;
  paidAt: Date;
  locale: ReceiptLocale;
}

const STRINGS: Record<ReceiptLocale, Record<string, string>> = {
  en: {
    receipt: 'Receipt',
    ticket: 'Ticket',
    table: 'Table',
    servedBy: 'Served by',
    date: 'Date',
    total: 'Total',
    paid: 'Paid',
    cash: 'Cash',
    card: 'Card',
    mobile: 'Mobile money',
    change: 'Change',
    thanks: 'Thank you for your visit!',
    free: 'Free',
  },
  fr: {
    receipt: 'Reçu',
    ticket: 'Ticket',
    table: 'Table',
    servedBy: 'Servi par',
    date: 'Date',
    total: 'Total',
    paid: 'Payé',
    cash: 'Espèces',
    card: 'Carte',
    mobile: 'Mobile money',
    change: 'Monnaie',
    thanks: 'Merci de votre visite !',
    free: 'Gratuit',
  },
  ar: {
    receipt: 'إيصال',
    ticket: 'تذكرة',
    table: 'طاولة',
    servedBy: 'قدّمه',
    date: 'التاريخ',
    total: 'المجموع',
    paid: 'مدفوع',
    cash: 'نقدًا',
    card: 'بطاقة',
    mobile: 'محفظة إلكترونية',
    change: 'الباقي',
    thanks: 'شكرًا لزيارتكم!',
    free: 'مجاني',
  },
};

function tr(locale: ReceiptLocale, key: string): string {
  return STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}

/** Localised method name (cash / card / etc.) for the receipt footer. */
function methodLabel(locale: ReceiptLocale, method: string): string {
  const m = method.toLowerCase();
  if (m === 'cash') return tr(locale, 'cash');
  if (m === 'card' || m === 'cib' || m === 'edahabia' || m === 'stripe') return tr(locale, 'card');
  if (m === 'mobile_money') return tr(locale, 'mobile');
  return method;
}

/**
 * 2-decimal money render, thin-space thousand separators, comma decimal —
 * matches the Station's formatMoney exactly.
 */
function formatMoney(amount: number, currency: string, decimals = 2): string {
  const dec = Math.max(0, decimals);
  const fixed = (amount ?? 0).toFixed(dec);
  const [intPart, decPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const body = sign ? intPart.slice(1) : intPart;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const num = decPart ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
  return currency ? `${num} ${currency}` : num;
}

function formatDate(d: Date, locale: ReceiptLocale): string {
  const tag =
    locale === 'ar' ? 'ar-DZ' :
    locale === 'fr' ? 'fr-DZ' :
    'en-US';
  try {
    return d.toLocaleString(tag, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}

/**
 * Build the chat-message receipt. WhatsApp / Messenger preserve plain
 * newlines, so we use line breaks + spaces (no fancy box-drawing —
 * thermal printer handles that).
 */
export function buildReceiptText(args: ReceiptArgs): string {
  const { orgName, ticketNumber, tableCode, staffName, items, total,
          method, tendered, change, currency, decimals = 2, paidAt, locale } = args;

  const lines: string[] = [];

  // Header
  lines.push(`*${orgName}*`);
  lines.push(`_${tr(locale, 'receipt')}_`);
  lines.push('');

  // Meta
  lines.push(`${tr(locale, 'ticket')}: ${ticketNumber}`);
  if (tableCode) lines.push(`${tr(locale, 'table')}: ${tableCode}`);
  if (staffName) lines.push(`${tr(locale, 'servedBy')}: ${staffName}`);
  lines.push(`${tr(locale, 'date')}: ${formatDate(paidAt, locale)}`);
  lines.push('');
  lines.push('────────────────────');

  // Items
  for (const it of items) {
    const qtyName = `${it.qty}× ${it.name}`;
    const priceLabel = it.price == null
      ? tr(locale, 'free')
      : formatMoney(it.price * it.qty, currency, decimals);
    lines.push(`${qtyName}`);
    lines.push(`   ${priceLabel}`);
  }

  lines.push('────────────────────');

  // Totals
  lines.push(`*${tr(locale, 'total')}: ${formatMoney(total, currency, decimals)}*`);
  lines.push(`${tr(locale, 'paid')} (${methodLabel(locale, method)}): ${formatMoney(tendered ?? total, currency, decimals)}`);
  if (change != null && change > 0) {
    lines.push(`${tr(locale, 'change')}: ${formatMoney(change, currency, decimals)}`);
  }
  lines.push('');
  lines.push(tr(locale, 'thanks'));

  return lines.join('\n');
}
