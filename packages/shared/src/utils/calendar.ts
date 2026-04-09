// ── Calendar Utilities ─────────────────────────────────────────────
// Pure timezone-aware functions for building week/month calendar views.
// Uses Intl.DateTimeFormat for correct timezone handling — no external deps.

import type { CalendarAppointment, AppointmentStatus } from '../types';

// ── Constants ──────────────────────────────────────────────────────

export const CALENDAR_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type CalendarDay = (typeof CALENDAR_DAYS)[number];

export const STATUS_COLORS: Record<AppointmentStatus, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  checked_in: '#8b5cf6',
  completed: '#22c55e',
  cancelled: '#ef4444',
  no_show: '#64748b',
  declined: '#991b1b',
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

/** Get 7 days (Mon–Sun) for the week containing the given date, in the office timezone */
export function getWeekDays(anchorDate: Date, timezone: string): CalendarDayInfo[] {
  const todayKey = dateKeyInTz(new Date(), timezone);
  const dow = getDayOfWeekInTz(anchorDate, timezone);
  const monday = new Date(anchorDate);
  monday.setDate(monday.getDate() - dow);
  monday.setHours(0, 0, 0, 0);

  return CALENDAR_DAYS.map((dayName, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateKey = dateKeyInTz(d, timezone);
    return { date: d, dateKey, dayName, isToday: dateKey === todayKey };
  });
}

/** Get UTC ISO range for a full week (Mon 00:00 → Sun 23:59:59) */
export function getWeekRange(anchorDate: Date, timezone: string): { start: string; end: string } {
  const days = getWeekDays(anchorDate, timezone);
  return {
    start: dateStartIso(days[0].dateKey, timezone),
    end: dateEndIso(days[6].dateKey, timezone),
  };
}

/** Navigate by +/- weeks */
export function shiftWeek(current: Date, direction: -1 | 1): Date {
  const d = new Date(current);
  d.setDate(d.getDate() + direction * 7);
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
  // First day of month
  const firstOfMonth = new Date(year, month, 1);
  const dow = getDayOfWeekInTz(firstOfMonth, timezone); // 0=Mon
  // Start from the Monday before (or on) the 1st
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - dow);

  const days: MonthDayInfo[] = [];
  for (let i = 0; i < 42; i++) { // 6 rows × 7 cols
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateKey = dateKeyInTz(d, timezone);
    days.push({
      date: d,
      dateKey,
      isCurrentMonth: d.getMonth() === month,
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

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status as AppointmentStatus] ?? '#64748b';
}

export function getServiceColor(service?: { color?: string | null } | null): string {
  return service?.color || DEFAULT_SERVICE_COLOR;
}

// ── Formatting helpers ─────────────────────────────────────────────

/** Format a date for display in the calendar header: "Mon 14" */
export function formatDayHeader(date: Date, timezone: string, locale?: string): string {
  try {
    const d = new Intl.DateTimeFormat(locale ?? 'en-US', {
      weekday: 'short', day: 'numeric', timeZone: timezone,
    });
    return d.format(date);
  } catch {
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  }
}

/** Format month+year: "June 2026" */
export function formatMonthYear(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'long', year: 'numeric' }).format(date);
}

/** Format date range for header: "14 - 18 Jun, 2026" */
export function formatWeekRange(startDate: Date, endDate: Date, locale?: string): string {
  const fmt = new Intl.DateTimeFormat(locale ?? 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
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
