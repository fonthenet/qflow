// Money formatting + parsing.
//
// Amounts are stored in the org's main currency unit (DA for Algeria,
// $ for US, € for France, etc.) as floats. The Station looks up the
// org's country config to pick the symbol + decimal places at render
// time — there is no hardcoded currency.
//
// The old "centimes" sub-unit toggle (Algeria folk habit of quoting
// prices ×100) was removed in favor of a single canonical display:
// every country renders amounts in its main unit with its own decimals.

export function formatMoney(
  amount: number,
  currency = '',
  decimals = 2,
): string {
  const suffix = currency ? ` ${currency}` : '';
  if (!isFinite(amount)) return `0${suffix}`;
  // Fixed decimals, comma separator, thin-space thousands grouping.
  const [intPart, decPart] = amount.toFixed(decimals).split('.');
  return decPart
    ? `${groupDigits(intPart)},${decPart}${suffix}`
    : `${groupDigits(intPart)}${suffix}`;
}

// Parse operator input back into a main-unit value (accepts "1234.56"
// or "1234,56"). No sub-unit conversion — what the operator types is
// what gets stored.
export function parseMoney(input: string): number {
  const raw = input.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!raw) return 0;
  const n = Number(raw);
  return isFinite(n) ? n : 0;
}

// Displays the amount inside an <input>. Fixed decimals so the
// operator sees a stable placeholder (e.g. "1234.56", "1234.000").
export function formatMoneyForInput(amount: number, decimals = 2): string {
  return amount.toFixed(decimals);
}

// Quick-add button values in the org's main currency unit. Reasonable
// cash denominations that work across currencies (5/10/20/50 of main
// unit × 100 for small-denomination currencies like DA/JPY — apps
// scale these per-country if they want).
export const QUICK_ADD = [500, 1000, 2000, 5000];

export function labelForQuickAdd(amount: number): string {
  return `+${groupDigits(String(amount))}`;
}

function groupDigits(s: string): string {
  // Thin space every 3 digits from the right. Works for positive integers/decimals.
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return neg ? `-${grouped}` : grouped;
}
