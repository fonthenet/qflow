import { Linking } from 'react-native';

/**
 * Normalise a phone string to an international tel: URI.
 *
 * Detection rules (digits-only):
 *  1. Already has "+"                        → international, use as-is
 *  2. Starts with "0" and 10 digits total    → Algerian (+213, drop leading 0)
 *  3. Exactly 10 digits (no leading 0)       → US (+1)
 *  4. 11 digits starting with "1"            → US (+1 already included)
 *  5. Anything else                          → pass through raw
 */
export function toTelUri(raw: string): string {
  const trimmed = raw.trim();

  // Already international
  if (trimmed.startsWith('+')) return `tel:${trimmed}`;

  const digits = trimmed.replace(/\D/g, '');

  // Algeria: 0 + 9 subscriber digits = 10 total, leading 0
  if (digits.length === 10 && digits.startsWith('0')) {
    return `tel:+213${digits.slice(1)}`;
  }

  // US: 10 digits without leading 0 (area code + number)
  if (digits.length === 10) {
    return `tel:+1${digits}`;
  }

  // US: 11 digits, country code 1 already present
  if (digits.length === 11 && digits.startsWith('1')) {
    return `tel:+${digits}`;
  }

  // Fallback — dial as entered
  return `tel:${trimmed}`;
}

/** Open the phone dialler with smart country-code detection. */
export function callPhone(phone: string) {
  Linking.openURL(toTelUri(phone));
}
