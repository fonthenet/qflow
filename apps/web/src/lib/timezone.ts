/**
 * Timezone utilities — single source of truth for datetime normalization.
 *
 * All appointment/booking times are entered by users in the org's local timezone.
 * This module converts naive datetime strings (no offset) to proper UTC-aware
 * ISO strings before storage, so they display correctly in any timezone context.
 */

/**
 * Convert a naive datetime string to a timezone-aware ISO string.
 *
 * If the input already has a timezone offset (Z or ±HH:MM), it's returned as-is.
 * If naive (e.g. "2026-04-18T12:00:00"), the timezone parameter is used to
 * compute the correct UTC offset and append it.
 *
 * Works for any IANA timezone (Africa/Algiers, Europe/Paris, America/New_York, etc.)
 * and automatically handles DST transitions.
 *
 * @param datetime  ISO-ish datetime string, e.g. "2026-04-18T12:00:00"
 * @param timezone  IANA timezone identifier, e.g. "Africa/Algiers"
 * @returns         Timezone-aware string, e.g. "2026-04-18T12:00:00+01:00"
 */
export function toTimezoneAware(datetime: string, timezone: string): string {
  // Already has offset — nothing to do
  if (/[+-]\d{2}:\d{2}$/.test(datetime) || datetime.endsWith('Z')) {
    return datetime;
  }

  if (!datetime.includes('T')) {
    return datetime;
  }

  try {
    // Parse as UTC to get a consistent epoch reference point
    const naive = new Date(datetime + 'Z');
    if (isNaN(naive.getTime())) return datetime;

    // Compute the UTC offset for this timezone at this moment in time
    const utcStr = naive.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = naive.toLocaleString('en-US', { timeZone: timezone });
    const diffMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();

    const sign = diffMs >= 0 ? '+' : '-';
    const absMs = Math.abs(diffMs);
    const h = String(Math.floor(absMs / 3600000)).padStart(2, '0');
    const m = String(Math.floor((absMs % 3600000) / 60000)).padStart(2, '0');

    return `${datetime}${sign}${h}:${m}`;
  } catch {
    return datetime;
  }
}
