// Money formatting + parsing for the Algeria market.
//
// Amounts are ALWAYS stored in dinars (DA) as floats with 2-decimal
// (centime) resolution. The operator can toggle how they are displayed
// and typed via the POS currency-unit pref:
//
//   - 'da'       → "1 234,56 DA"   (bank-style, 2 decimals always)
//   - 'centimes' → "123 456 centim" (integer, ×100 of the DA value)
//
// Colloquially in Algeria people often quote prices in centimes
// ("cent mille" = 100 000 centimes = 1 000 DA), so the centimes view
// matches everyday speech. Storage stays in DA so the whole system
// (menu, reports, cloud sync) keeps a single canonical representation.

export type CurrencyUnit = 'da' | 'centimes';

const CENTIMES_LABEL = 'centim';

export function formatMoney(amountDA: number, unit: CurrencyUnit, currency = 'DA'): string {
  if (!isFinite(amountDA)) return `0 ${unit === 'centimes' ? CENTIMES_LABEL : currency}`;
  if (unit === 'centimes') {
    const centimes = Math.round(amountDA * 100);
    return `${groupDigits(String(centimes))} ${CENTIMES_LABEL}`;
  }
  // DA: always 2 decimals, comma separator, thin-space thousands grouping.
  const [intPart, decPart] = amountDA.toFixed(2).split('.');
  return `${groupDigits(intPart)},${decPart} ${currency}`;
}

// Parse operator input back into a DA value. In 'da' mode we accept
// "1234.56" / "1234,56" directly; in 'centimes' mode we divide by 100
// so typing 100000 means 1000 DA.
export function parseMoney(input: string, unit: CurrencyUnit): number {
  const raw = input.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!raw) return 0;
  const n = Number(raw);
  if (!isFinite(n)) return 0;
  return unit === 'centimes' ? n / 100 : n;
}

// Displays the amount inside an <input> (so the operator sees the same
// unit they configured). DA mode keeps trailing zeros; centimes mode
// is always integer.
export function formatMoneyForInput(amountDA: number, unit: CurrencyUnit): string {
  if (unit === 'centimes') return String(Math.round(amountDA * 100));
  return amountDA.toFixed(2);
}

// Quick-add button values. In DA they are 500/1000/2000/5000 DA. In
// centimes view we want the equivalent nice round labels — same
// dinar values, rendered as centimes.
export const QUICK_ADD_DA = [500, 1000, 2000, 5000];

export function labelForQuickAdd(amountDA: number, unit: CurrencyUnit): string {
  if (unit === 'centimes') return `+${groupDigits(String(amountDA * 100))}`;
  return `+${groupDigits(String(amountDA))}`;
}

function groupDigits(s: string): string {
  // Thin space every 3 digits from the right. Works for positive integers/decimals.
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return neg ? `-${grouped}` : grouped;
}
