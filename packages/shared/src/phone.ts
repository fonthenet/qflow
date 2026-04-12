/**
 * Unified phone normalization & country dial code mappings.
 *
 * Single source of truth — replaces duplicated TZ_DIAL / ISO_DIAL / CC_DIAL
 * maps and normalizePhone* functions that were scattered across:
 *   - apps/desktop/electron/sync.ts
 *   - apps/desktop/electron/kiosk-server.ts
 *   - apps/web/src/lib/whatsapp.ts
 *   - apps/web/src/lib/messaging-commands.ts
 *   - supabase/functions/notify-ticket/index.ts
 */

// ── Timezone → country calling code ────────────────────────────────
// Superset of all entries from every previous copy.

export const TZ_DIAL: Record<string, string> = {
  // Africa
  'Africa/Algiers': '213',
  'Africa/Tunis': '216',
  'Africa/Casablanca': '212',
  'Africa/Cairo': '20',
  'Africa/Lagos': '234',
  'Africa/Nairobi': '254',
  'Africa/Johannesburg': '27',
  // Europe
  'Europe/Paris': '33',
  'Europe/London': '44',
  'Europe/Berlin': '49',
  'Europe/Madrid': '34',
  'Europe/Rome': '39',
  'Europe/Brussels': '32',
  'Europe/Amsterdam': '31',
  'Europe/Zurich': '41',
  'Europe/Istanbul': '90',
  // Middle East
  'Asia/Riyadh': '966',
  'Asia/Dubai': '971',
  'Asia/Qatar': '974',
  'Asia/Kuwait': '965',
  'Asia/Bahrain': '973',
  'Asia/Muscat': '968',
  'Asia/Amman': '962',
  'Asia/Beirut': '961',
  'Asia/Baghdad': '964',
  // Americas
  'America/New_York': '1',
  'America/Chicago': '1',
  'America/Denver': '1',
  'America/Los_Angeles': '1',
  'America/Toronto': '1',
  'America/Sao_Paulo': '55',
  'America/Mexico_City': '52',
  // Asia-Pacific
  'Asia/Kolkata': '91',
  'Asia/Shanghai': '86',
  'Asia/Tokyo': '81',
  'Australia/Sydney': '61',
};

// ── ISO 3166-1 alpha-2 → country calling code ──────────────────────

export const ISO_DIAL: Record<string, string> = {
  DZ: '213', TN: '216', MA: '212', EG: '20', NG: '234', KE: '254', ZA: '27',
  FR: '33', GB: '44', DE: '49', ES: '34', IT: '39', BE: '32', NL: '31',
  CH: '41', TR: '90', SA: '966', AE: '971', QA: '974', KW: '965',
  BH: '973', OM: '968', JO: '962', LB: '961', IQ: '964',
  US: '1', CA: '1', MX: '52', BR: '55',
  IN: '91', CN: '86', JP: '81', AU: '61',
};

// Unique dial codes sorted longest-first (3-digit before 2-digit before 1-digit).
const ALL_DIAL_CODES = Object.values(ISO_DIAL)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort((a, b) => b.length - a.length);

/**
 * Resolve the country dial code from timezone and/or ISO country code.
 * Prefers country code (more specific) over timezone.
 */
export function resolveDialCode(timezone?: string | null, countryCode?: string | null): string | null {
  if (countryCode) {
    const fromCC = ISO_DIAL[countryCode.toUpperCase()];
    if (fromCC) return fromCC;
  }
  if (timezone) {
    const fromTZ = TZ_DIAL[timezone];
    if (fromTZ) return fromTZ;
  }
  return null;
}

/**
 * Normalize a phone number to digits-only international format (no + prefix).
 * Suitable for Meta WhatsApp Cloud API and internal storage.
 *
 * @param phone   Raw phone string (may include +, spaces, dashes, "whatsapp:" prefix)
 * @param timezone  IANA timezone of the business (e.g. "Africa/Algiers")
 * @param countryCode  ISO 3166-1 alpha-2 country code (e.g. "DZ")
 * @returns Digits-only international number, or null if too short
 */
export function normalizePhone(
  phone: string,
  timezone?: string | null,
  countryCode?: string | null,
): string | null {
  // Strip channel prefix (Twilio "whatsapp:" prefix)
  let s = phone.trim().replace(/^whatsapp:/i, '');

  // Handle "00" international prefix (common in MENA)
  if (s.startsWith('00')) s = s.slice(2);

  const hasPlus = s.startsWith('+');
  const digits = s.replace(/[^\d]/g, '');

  if (digits.length < 7) return null;

  // Already international with + prefix → use as-is
  if (hasPlus) return digits;

  const dialCode = resolveDialCode(timezone, countryCode);

  // Local format: starts with 0 → strip it and prepend country dial code
  if (digits.startsWith('0') && dialCode) {
    return dialCode + digits.slice(1);
  }

  // Already starts with the business's own dial code → use as-is
  if (dialCode && digits.startsWith(dialCode) && digits.length > dialCode.length + 6) {
    return digits;
  }

  // Detect if the number already starts with ANY known country code
  for (const code of ALL_DIAL_CODES) {
    if (digits.startsWith(code) && digits.length >= code.length + 7) {
      return digits;
    }
  }

  // US/Canada: 10-digit number → prepend 1
  if (digits.length === 10 && !digits.startsWith('0')) {
    return '1' + digits;
  }

  // Algeria: 9-digit subscriber number without leading 0
  if (digits.length === 9 && dialCode === '213') {
    return '213' + digits;
  }

  // France: 9-digit subscriber number without leading 0
  if (digits.length === 9 && dialCode === '33') {
    return '33' + digits;
  }

  // Generic: short local number → prepend office dial code
  if (dialCode && digits.length <= 9 && !digits.startsWith(dialCode)) {
    return dialCode + digits;
  }

  return digits;
}
