/**
 * Date/time formatting helpers that always honor the OFFICE's timezone when
 * provided, falling back to the device timezone. Customer-facing screens
 * should always pass the office timezone so times match what staff see on
 * the Station / web portal for that branch.
 */

function safeTimeZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  const trimmed = tz.trim();
  if (!trimmed) return undefined;
  // Validate — if the runtime rejects it, fall back to device tz instead of
  // throwing. Keeps things graceful if the DB ever has a bogus value.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return undefined;
  }
}

export function formatTime(
  value: Date | string | number | null | undefined,
  timezone?: string | null,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false },
): string {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale || undefined, {
    ...options,
    timeZone: safeTimeZone(timezone),
  });
}

export function formatDate(
  value: Date | string | number | null | undefined,
  timezone?: string | null,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale || undefined, {
    ...options,
    timeZone: safeTimeZone(timezone),
  });
}

export function formatDateTime(
  value: Date | string | number | null | undefined,
  timezone?: string | null,
  locale?: string,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  },
): string {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale || undefined, {
    ...options,
    timeZone: safeTimeZone(timezone),
  });
}
