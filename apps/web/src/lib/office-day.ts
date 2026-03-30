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
  // Get today's date in the office timezone (e.g. '2026-03-30' for Africa/Algiers)
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // Find the UTC equivalent of midnight in the office timezone:
  // 1. Start with midnight UTC on that date
  const midnightUtc = new Date(`${localDate}T00:00:00Z`);
  // 2. See what time that is in the office timezone
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
  // 3. Compute offset: how far ahead/behind is the office timezone
  let offsetMs = (tzHour * 60 + tzMin) * 60 * 1000;
  if (tzDay < localDate) offsetMs -= 24 * 60 * 60 * 1000; // west of UTC
  // 4. Office midnight = UTC midnight - offset
  return new Date(midnightUtc.getTime() - offsetMs).toISOString();
}
