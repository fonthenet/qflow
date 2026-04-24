// ── Business location helpers ─────────────────────────────────────
// Glue between the shared signup wizard (which collects country + city
// as free strings) and the first-class columns on `organizations` and
// `offices`. Also maps Algerian cities → wilaya for the public
// directory (wilaya is Algeria-only; other countries leave it null per
// the country-gated-features rule).

import { WILAYAS } from './wilayas';

/** Normalize a city/wilaya name for fuzzy matching: NFD-decompose,
 *  strip diacritics, lowercase, collapse whitespace. Handles "Sétif"
 *  ↔ "Setif", "Alger" ↔ "alger", etc. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Common English ↔ French/Arabic city spellings that do NOT share a
 *  normalized root. Most Algerian city names are identical in French
 *  and the wilaya list, so this stays small. */
const CITY_ALIASES: Record<string, string> = {
  // English → French/Latin form used in WILAYAS
  algiers: 'alger',
  bejaia: 'bejaia',
  oran: 'oran',
};

/** Resolve a user-entered city (in any locale) to an Algerian wilaya
 *  name (French/Latin form). Returns null if the country isn't Algeria
 *  or no wilaya matches — callers should leave `offices.wilaya` null in
 *  that case. */
export function resolveCityToWilaya(
  countryCode: string | null | undefined,
  cityName: string | null | undefined,
): string | null {
  if (countryCode !== 'DZ' || !cityName) return null;
  const needle = CITY_ALIASES[normalize(cityName)] ?? normalize(cityName);
  const match = WILAYAS.find(
    (w) => normalize(w.name) === needle || normalize(w.name_ar) === needle,
  );
  return match?.name ?? null;
}
