/**
 * Compute the UTC offset in milliseconds for a given date string
 * (YYYY-MM-DD) in the given timezone.
 */
function tzOffsetMs(dateStr: string, tz: string): number {
  const midnightUtc = new Date(`${dateStr}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(midnightUtc);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const tzDay = `${get('year')}-${get('month')}-${get('day')}`;
  const tzHour = parseInt(get('hour'));
  const tzMin = parseInt(get('minute'));
  let offset = (tzHour * 60 + tzMin) * 60 * 1000;
  if (tzDay < dateStr) offset -= 24 * 60 * 60 * 1000; // west of UTC
  return offset;
}

/**
 * Returns the UTC ISO timestamp corresponding to midnight (start of day)
 * in the given office timezone. This ensures correct date filtering
 * against Supabase `timestamptz` columns.
 *
 * Example: Africa/Algiers (UTC+1) on March 30 → "2026-03-29T23:00:00.000Z"
 */
export function getOfficeDayStartIso(timezone?: string | null): string {
  const tz = timezone || 'UTC';
  const now = new Date();
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const midnightUtc = new Date(`${localDate}T00:00:00Z`);
  return new Date(midnightUtc.getTime() - tzOffsetMs(localDate, tz)).toISOString();
}

/**
 * Returns the UTC ISO timestamp corresponding to 23:59:59 (end of day)
 * in the given office timezone.
 */
export function getOfficeDayEndIso(timezone?: string | null): string {
  const tz = timezone || 'UTC';
  const now = new Date();
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const endOfDayUtc = new Date(`${localDate}T23:59:59Z`);
  return new Date(endOfDayUtc.getTime() - tzOffsetMs(localDate, tz)).toISOString();
}

/**
 * Returns the UTC ISO timestamp for midnight of a specific date (YYYY-MM-DD)
 * in the given timezone.
 */
export function getDateStartIso(date: string, timezone?: string | null): string {
  const tz = timezone || 'UTC';
  const midnightUtc = new Date(`${date}T00:00:00Z`);
  return new Date(midnightUtc.getTime() - tzOffsetMs(date, tz)).toISOString();
}

/**
 * Returns the UTC ISO timestamp for 23:59:59 of a specific date (YYYY-MM-DD)
 * in the given timezone.
 */
export function getDateEndIso(date: string, timezone?: string | null): string {
  const tz = timezone || 'UTC';
  const endOfDayUtc = new Date(`${date}T23:59:59Z`);
  return new Date(endOfDayUtc.getTime() - tzOffsetMs(date, tz)).toISOString();
}
