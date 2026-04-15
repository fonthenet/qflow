// ── Calendar Utilities ─────────────────────────────────────────────
// Pure timezone-aware functions for building week/month calendar views.
// Uses Intl.DateTimeFormat for correct timezone handling — no external deps.

import type { CalendarAppointment, AppointmentStatus } from '../types';

// ── Constants ──────────────────────────────────────────────────────

export const CALENDAR_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type CalendarDay = (typeof CALENDAR_DAYS)[number];

export const STATUS_COLORS: Record<AppointmentStatus, string> = {
  pending: '#f59e0b',    // amber  — awaiting action
  confirmed: '#3b82f6',  // blue   — approved & scheduled
  checked_in: '#06b6d4', // cyan   — present / arrived
  completed: '#22c55e',  // green  — done
  cancelled: '#ef4444',  // red    — cancelled
  no_show: '#64748b',    // slate  — missed
  declined: '#991b1b',   // dark red — rejected
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  declined: 'Declined',
};

const DEFAULT_SERVICE_COLOR = '#6366f1';

// ── Timezone helpers ───────────────────────────────────────────────

/** Get "YYYY-MM-DD" for a Date in the given timezone */
export function dateKeyInTz(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

/** Get "HH:MM" for a Date in the given timezone */
export function formatTimeInTz(date: Date | string, timezone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    }).formatToParts(d);
    const h = parts.find(p => p.type === 'hour')?.value ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Get the hour (0-23) for a Date in the given timezone */
export function getHourInTz(date: Date | string, timezone: string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', hour12: false, timeZone: timezone,
    }).formatToParts(d);
    return parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  } catch {
    return d.getHours();
  }
}

/** Get minute offset (0-59) for a Date in the given timezone */
export function getMinuteInTz(date: Date | string, timezone: string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      minute: '2-digit', timeZone: timezone,
    }).formatToParts(d);
    return parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  } catch {
    return d.getMinutes();
  }
}

/** Get the day-of-week index (0=Mon, 6=Sun) in the given timezone */
function getDayOfWeekInTz(date: Date, timezone: string): number {
  try {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(date);
    const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return map[day] ?? 0;
  } catch {
    return (date.getDay() + 6) % 7; // JS day: 0=Sun → we want 0=Mon
  }
}

// ── Single source of truth: day name from dateKey ─────────────────

/**
 * Get the CalendarDay name from a YYYY-MM-DD string.
 * Uses UTC noon to avoid any timezone ambiguity — pure, deterministic.
 * This is THE canonical function for resolving day-of-week from a date.
 */
export function getDayNameFromKey(dateKey: string): CalendarDay {
  const d = new Date(dateKey + 'T12:00:00Z');
  const jsDow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return CALENDAR_DAYS[(jsDow + 6) % 7]; // convert to Mon-based
}

/**
 * Get the full day name (e.g. "sunday") from a YYYY-MM-DD string.
 * Equivalent to getDayNameFromKey but returns the full lowercase name
 * matching the format used by operating hours keys.
 */
export function getDayNameLongFromKey(dateKey: string): string {
  return getDayNameFromKey(dateKey);
}

/**
 * Get today's day name in the given timezone.
 * Combines dateKeyInTz + getDayNameFromKey for a safe, single-call API.
 */
export function getTodayDayName(timezone: string): CalendarDay {
  return getDayNameFromKey(dateKeyInTz(new Date(), timezone));
}

/**
 * Get operating hours for a specific date, using dateKey as source of truth.
 * Returns null if the day is closed (00:00–00:00 or missing).
 */
export function getDayHours(
  operatingHours: Record<string, { open: string; close: string }> | null | undefined,
  dateKey: string,
): { open: string; close: string } | null {
  if (!operatingHours) return null;
  const dayName = getDayNameFromKey(dateKey);
  const hours = operatingHours[dayName];
  if (!hours) return null;
  if (hours.open === '00:00' && hours.close === '00:00') return null;
  return hours;
}

/**
 * Check if a date is closed (no operating hours or 00:00–00:00).
 */
export function isDateClosed(
  operatingHours: Record<string, { open: string; close: string }> | null | undefined,
  dateKey: string,
): boolean {
  return getDayHours(operatingHours, dateKey) === null;
}

// ── UTC ISO boundaries for Supabase queries ────────────────────────

/** Compute UTC offset in ms for a given YYYY-MM-DD + timezone */
function tzOffsetMs(dateStr: string, tz: string): number {
  const midnightUtc = new Date(`${dateStr}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(midnightUtc);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  const tzDay = `${get('year')}-${get('month')}-${get('day')}`;
  const tzHour = parseInt(get('hour'));
  const tzMin = parseInt(get('minute'));
  let offset = (tzHour * 60 + tzMin) * 60 * 1000;
  if (tzDay < dateStr) offset -= 24 * 60 * 60 * 1000;
  return offset;
}

/** Midnight of a YYYY-MM-DD in the given timezone, returned as UTC ISO */
export function dateStartIso(dateStr: string, timezone: string): string {
  const midnightUtc = new Date(`${dateStr}T00:00:00Z`);
  return new Date(midnightUtc.getTime() - tzOffsetMs(dateStr, timezone)).toISOString();
}

/** 23:59:59 of a YYYY-MM-DD in the given timezone, returned as UTC ISO */
export function dateEndIso(dateStr: string, timezone: string): string {
  const endUtc = new Date(`${dateStr}T23:59:59.999Z`);
  return new Date(endUtc.getTime() - tzOffsetMs(dateStr, timezone)).toISOString();
}

// ── Week helpers ───────────────────────────────────────────────────

export interface CalendarDayInfo {
  date: Date;
  dateKey: string; // "YYYY-MM-DD"
  dayName: CalendarDay;
  isToday: boolean;
}

/**
 * Create a Date from a "YYYY-MM-DD" string at noon UTC (avoids DST edge cases).
 */
function dateFromKey(dateKey: string): Date {
  return new Date(dateKey + 'T12:00:00Z');
}

/**
 * Add `days` to a "YYYY-MM-DD" string, returning a new "YYYY-MM-DD" string.
 * Uses UTC noon to avoid any local-timezone or DST ambiguity.
 */
function addDaysToKey(dateKey: string, days: number): string {
  const d = dateFromKey(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Get 7 days for the week containing the given date, in the office timezone.
 * When `startFromToday` is true and anchorDate is within the current week,
 * the view starts from today and shows 7 consecutive days instead of Mon–Sun.
 *
 * IMPORTANT: All date arithmetic uses YYYY-MM-DD strings and UTC noon to avoid
 * the timezone mismatch bug where the machine's local timezone differs from
 * the office timezone (e.g. machine in UTC-7 but office in UTC+1).
 */
export function getWeekDays(anchorDate: Date, timezone: string, startFromToday = false): CalendarDayInfo[] {
  const todayKey = dateKeyInTz(new Date(), timezone);
  const anchorKey = dateKeyInTz(anchorDate, timezone);

  if (startFromToday && anchorKey === todayKey) {
    // Start from today and show 7 consecutive days
    return Array.from({ length: 7 }, (_, i) => {
      const dateKey = addDaysToKey(todayKey, i);
      const d = dateFromKey(dateKey);
      const jsDow = d.getUTCDay(); // 0=Sun (UTC is safe since we use noon)
      const dayName = CALENDAR_DAYS[(jsDow + 6) % 7]; // convert to Mon-based
      return { date: d, dateKey, dayName, isToday: dateKey === todayKey };
    });
  }

  // Default: Mon–Sun week — find Monday using the office timezone
  const anchorDow = getDayOfWeekInTz(anchorDate, timezone); // 0=Mon
  const mondayKey = addDaysToKey(anchorKey, -anchorDow);

  return CALENDAR_DAYS.map((dayName, i) => {
    const dateKey = addDaysToKey(mondayKey, i);
    const d = dateFromKey(dateKey);
    return { date: d, dateKey, dayName, isToday: dateKey === todayKey };
  });
}

/** Get UTC ISO range for a full week */
export function getWeekRange(anchorDate: Date, timezone: string, startFromToday = false): { start: string; end: string } {
  const days = getWeekDays(anchorDate, timezone, startFromToday);
  return {
    start: dateStartIso(days[0].dateKey, timezone),
    end: dateEndIso(days[6].dateKey, timezone),
  };
}

/** Navigate by +/- weeks */
export function shiftWeek(current: Date, direction: -1 | 1): Date {
  const d = new Date(current);
  d.setUTCDate(d.getUTCDate() + direction * 7);
  return d;
}

// ── Month helpers ──────────────────────────────────────────────────

export interface MonthDayInfo {
  date: Date;
  dateKey: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

/** Get a 6×7 grid of days for the month containing anchorDate */
export function getMonthGrid(year: number, month: number, timezone: string): MonthDayInfo[] {
  const todayKey = dateKeyInTz(new Date(), timezone);
  // First day of month — use UTC noon to avoid timezone issues
  const firstKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const firstOfMonth = dateFromKey(firstKey);
  const dow = getDayOfWeekInTz(firstOfMonth, timezone); // 0=Mon
  // Start from the Monday before (or on) the 1st
  const mondayKey = addDaysToKey(firstKey, -dow);

  const days: MonthDayInfo[] = [];
  for (let i = 0; i < 42; i++) { // 6 rows × 7 cols
    const dateKey = addDaysToKey(mondayKey, i);
    const d = dateFromKey(dateKey);
    const m = parseInt(dateKey.split('-')[1], 10) - 1;
    days.push({
      date: d,
      dateKey,
      isCurrentMonth: m === month,
      isToday: dateKey === todayKey,
    });
  }
  return days;
}

/** Get UTC ISO range for an entire month (1st 00:00 → last-day 23:59:59) */
export function getMonthRange(year: number, month: number, timezone: string): { start: string; end: string } {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const firstKey = dateKeyInTz(first, timezone);
  const lastKey = dateKeyInTz(last, timezone);
  return {
    start: dateStartIso(firstKey, timezone),
    end: dateEndIso(lastKey, timezone),
  };
}

/** Navigate by +/- months */
export function shiftMonth(current: Date, direction: -1 | 1): Date {
  const d = new Date(current);
  d.setMonth(d.getMonth() + direction);
  return d;
}

/** Get range for N months starting from a month */
export function getMultiMonthRange(startYear: number, startMonth: number, numMonths: number, timezone: string): { start: string; end: string } {
  const first = new Date(startYear, startMonth, 1);
  const firstKey = dateKeyInTz(first, timezone);
  const last = new Date(startYear, startMonth + numMonths, 0);
  const lastKey = dateKeyInTz(last, timezone);
  return {
    start: dateStartIso(firstKey, timezone),
    end: dateEndIso(lastKey, timezone),
  };
}

/** Check if a date is within N months from today */
export function isWithinHorizon(date: Date, maxMonths: number): boolean {
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth() + maxMonths, now.getDate());
  return date <= horizon;
}

// ── Grouping helpers ───────────────────────────────────────────────

/** Group appointments by their YYYY-MM-DD in the office timezone */
export function groupByDate(
  appointments: CalendarAppointment[],
  timezone: string,
): Map<string, CalendarAppointment[]> {
  const map = new Map<string, CalendarAppointment[]>();
  for (const a of appointments) {
    const key = dateKeyInTz(new Date(a.scheduled_at), timezone);
    const arr = map.get(key) ?? [];
    arr.push(a);
    map.set(key, arr);
  }
  return map;
}

/** Group appointments by hour (0-23) for a specific day, in the office timezone */
export function groupByHour(
  appointments: CalendarAppointment[],
  timezone: string,
): Map<number, CalendarAppointment[]> {
  const map = new Map<number, CalendarAppointment[]>();
  for (const a of appointments) {
    const h = getHourInTz(a.scheduled_at, timezone);
    const arr = map.get(h) ?? [];
    arr.push(a);
    map.set(h, arr);
  }
  return map;
}

/** Count appointments per date key */
export function countByDate(
  appointments: CalendarAppointment[],
  timezone: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of appointments) {
    const key = dateKeyInTz(new Date(a.scheduled_at), timezone);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// ── Color helpers ──────────────────────────────────────────────────

const EXTRA_STATUS_COLORS: Record<string, string> = {
  called: '#3b82f6',  // blue — called to desk
  serving: '#f97316', // orange — in-progress
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status as AppointmentStatus] ?? EXTRA_STATUS_COLORS[status] ?? '#64748b';
}

export function getServiceColor(service?: { color?: string | null } | null): string {
  return service?.color || DEFAULT_SERVICE_COLOR;
}

// ── Formatting helpers ─────────────────────────────────────────────

/** Format a date for display in the calendar header: "Mon 14" */
export function formatDayHeader(date: Date, timezone: string, locale?: string): string {
  try {
    const d = new Intl.DateTimeFormat(locale ?? 'fr-DZ', {
      weekday: 'short', day: 'numeric', timeZone: timezone,
    });
    return d.format(date);
  } catch {
    return date.toLocaleDateString('fr-DZ', { weekday: 'short', day: 'numeric' });
  }
}

/** Format month+year: "June 2026" */
export function formatMonthYear(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? 'fr-DZ', { month: 'long', year: 'numeric' }).format(date);
}

/** Format date range for header: "14 - 18 Jun, 2026" */
export function formatWeekRange(startDate: Date, endDate: Date, locale?: string): string {
  const fmt = new Intl.DateTimeFormat(locale ?? 'fr-DZ', { day: 'numeric', month: 'short', year: 'numeric' });
  const startDay = startDate.getDate();
  const endParts = fmt.format(endDate);
  return `${startDay} - ${endParts}`;
}

/** Get duration string from service estimated time */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}
