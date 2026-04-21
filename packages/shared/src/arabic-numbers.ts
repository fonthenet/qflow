/**
 * Integer → Modern Standard Arabic (MSA) word form, 0..9999.
 *
 * Why: Edge TTS pronounces the *digit* "81" using the selected voice's
 * dialect. Algerian (ar-DZ) voices say numbers with Algerian vocabulary —
 * "wāḥed" can come out closer to "wāḥen", "ʿishrīn" becomes "ʿashrīn",
 * etc. — which customers outside that region mishear. Writing the number
 * out in full MSA words forces every voice (DZ, SA, or any future
 * Arabic locale) to pronounce the exact same unambiguous sequence:
 * "wāḥid wa-thamānūn".
 *
 * Uses masculine counting (correct for a neutral noun like "ticket
 * number" in context). Covers 0..9999 which is well beyond any realistic
 * ticket number range.
 */

const UNITS: Record<number, string> = {
  0: 'صفر',
  1: 'واحد',
  2: 'اثنان',
  3: 'ثلاثة',
  4: 'أربعة',
  5: 'خمسة',
  6: 'ستة',
  7: 'سبعة',
  8: 'ثمانية',
  9: 'تسعة',
  10: 'عشرة',
  11: 'أحد عشر',
  12: 'اثنا عشر',
  13: 'ثلاثة عشر',
  14: 'أربعة عشر',
  15: 'خمسة عشر',
  16: 'ستة عشر',
  17: 'سبعة عشر',
  18: 'ثمانية عشر',
  19: 'تسعة عشر',
};

const TENS: Record<number, string> = {
  20: 'عشرون',
  30: 'ثلاثون',
  40: 'أربعون',
  50: 'خمسون',
  60: 'ستون',
  70: 'سبعون',
  80: 'ثمانون',
  90: 'تسعون',
};

const HUNDREDS: Record<number, string> = {
  100: 'مئة',
  200: 'مئتان',
  300: 'ثلاثمئة',
  400: 'أربعمئة',
  500: 'خمسمئة',
  600: 'ستمئة',
  700: 'سبعمئة',
  800: 'ثمانمئة',
  900: 'تسعمئة',
};

function below100(n: number): string {
  if (n in UNITS) return UNITS[n];
  const tens = Math.floor(n / 10) * 10;
  const units = n % 10;
  if (units === 0) return TENS[tens];
  // "واحد وعشرون" — units precede tens, joined by "و" (and).
  return `${UNITS[units]} و${TENS[tens]}`;
}

function below1000(n: number): string {
  if (n < 100) return below100(n);
  const hundreds = Math.floor(n / 100) * 100;
  const rem = n % 100;
  if (rem === 0) return HUNDREDS[hundreds];
  return `${HUNDREDS[hundreds]} و${below100(rem)}`;
}

/**
 * Return the Arabic (MSA) word form of `n`. Falls back to the numeric
 * string for values outside the supported 0..9999 range — TTS will then
 * pronounce the digits, which is better than throwing on edge cases.
 */
export function arabicNumberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 9999 || !Number.isInteger(n)) {
    return String(n);
  }
  if (n < 1000) return below1000(n);
  const thousands = Math.floor(n / 1000);
  const rem = n % 1000;
  // 1000 is "ألف" singular; 2..9 thousand uses "آلاف" plural with
  // masculine unit counting ("ثلاثة آلاف" = 3000).
  const thousandsWord = thousands === 1
    ? 'ألف'
    : thousands === 2
      ? 'ألفان'
      : `${UNITS[thousands]} آلاف`;
  if (rem === 0) return thousandsWord;
  return `${thousandsWord} و${below1000(rem)}`;
}
