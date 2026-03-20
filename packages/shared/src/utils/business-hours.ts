// ── Business Hours Utility ────────────────────────────────────────
// Pure functions for checking if an office is open/closed.
// Uses Intl.DateTimeFormat for timezone-aware day/time resolution.
// Convention: open === '00:00' && close === '00:00' means closed for that day.

export interface DayHours {
  open: string; // "08:00"
  close: string; // "17:00"
}

export type OperatingHours = Record<string, DayHours>;

export interface OfficeHoliday {
  holiday_date: string; // "2026-03-25"
  name: string;
  is_full_day?: boolean;
  open_time?: string | null;
  close_time?: string | null;
}

export interface BusinessHoursResult {
  isOpen: boolean;
  reason: 'open' | 'closed_today' | 'before_hours' | 'after_hours' | 'holiday' | 'no_hours';
  todayHours: DayHours | null;
  holidayName?: string;
  /** Next opening info for display */
  nextOpen?: { day: string; time: string };
  /** Current time string in office timezone (HH:MM) */
  currentTime: string;
  /** Current day name lowercase */
  currentDay: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Get current day and time in the office's timezone
 */
function getOfficeLocalTime(timezone: string, now?: Date): { day: string; time: string; dayIndex: number } {
  const d = now ?? new Date();
  try {
    // Get day of week in office timezone
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone });
    const day = dayFormatter.format(d).toLowerCase();

    // Get time in office timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
    const parts = timeFormatter.formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

    return { day, time, dayIndex: DAYS.indexOf(day) };
  } catch {
    // Fallback if timezone is invalid
    const day = DAYS[d.getDay()];
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { day, time, dayIndex: d.getDay() };
  }
}

/**
 * Get today's date string in office timezone (YYYY-MM-DD)
 */
function getOfficeDateString(timezone: string, now?: Date): string {
  const d = now ?? new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
    return formatter.format(d);
  } catch {
    return d.toISOString().split('T')[0];
  }
}

function isDayClosed(hours: DayHours): boolean {
  return hours.open === '00:00' && hours.close === '00:00';
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Check if an office is currently open
 */
export function isOfficeOpen(
  operatingHours: OperatingHours | null | undefined,
  timezone: string,
  holidays?: OfficeHoliday[],
  now?: Date,
): BusinessHoursResult {
  const { day, time, dayIndex } = getOfficeLocalTime(timezone || 'UTC', now);
  const todayDate = getOfficeDateString(timezone || 'UTC', now);

  const base = { currentTime: time, currentDay: day };

  // No operating hours configured — assume always open
  if (!operatingHours || Object.keys(operatingHours).length === 0) {
    return { ...base, isOpen: true, reason: 'no_hours', todayHours: null };
  }

  // Check holidays first
  if (holidays && holidays.length > 0) {
    const holiday = holidays.find(h => h.holiday_date === todayDate);
    if (holiday) {
      if (holiday.is_full_day !== false) {
        // Full-day holiday
        const next = findNextOpen(operatingHours, dayIndex, holidays, timezone, now);
        return { ...base, isOpen: false, reason: 'holiday', todayHours: null, holidayName: holiday.name, nextOpen: next };
      }
      // Partial-day holiday — use overridden hours
      if (holiday.open_time && holiday.close_time) {
        const overriddenHours = { open: holiday.open_time, close: holiday.close_time };
        if (isDayClosed(overriddenHours)) {
          const next = findNextOpen(operatingHours, dayIndex, holidays, timezone, now);
          return { ...base, isOpen: false, reason: 'holiday', todayHours: null, holidayName: holiday.name, nextOpen: next };
        }
        return checkTimeRange(overriddenHours, time, dayIndex, operatingHours, holidays, timezone, now, base);
      }
    }
  }

  // Get today's hours
  const todayHours = operatingHours[day];
  if (!todayHours || isDayClosed(todayHours)) {
    const next = findNextOpen(operatingHours, dayIndex, holidays, timezone, now);
    return { ...base, isOpen: false, reason: 'closed_today', todayHours: null, nextOpen: next };
  }

  return checkTimeRange(todayHours, time, dayIndex, operatingHours, holidays, timezone, now, base);
}

function checkTimeRange(
  todayHours: DayHours,
  currentTime: string,
  dayIndex: number,
  operatingHours: OperatingHours,
  holidays: OfficeHoliday[] | undefined,
  timezone: string,
  now: Date | undefined,
  base: { currentTime: string; currentDay: string },
): BusinessHoursResult {
  const currentMins = timeToMinutes(currentTime);
  const openMins = timeToMinutes(todayHours.open);
  const closeMins = timeToMinutes(todayHours.close);

  if (currentMins < openMins) {
    return { ...base, isOpen: false, reason: 'before_hours', todayHours, nextOpen: { day: base.currentDay, time: todayHours.open } };
  }

  if (currentMins >= closeMins) {
    const next = findNextOpen(operatingHours, dayIndex, holidays, timezone, now);
    return { ...base, isOpen: false, reason: 'after_hours', todayHours, nextOpen: next };
  }

  return { ...base, isOpen: true, reason: 'open', todayHours };
}

function findNextOpen(
  operatingHours: OperatingHours,
  currentDayIndex: number,
  holidays?: OfficeHoliday[],
  _timezone?: string,
  _now?: Date,
): { day: string; time: string } | undefined {
  // Look up to 7 days ahead
  for (let offset = 1; offset <= 7; offset++) {
    const idx = (currentDayIndex + offset) % 7;
    const dayName = DAYS[idx];
    const hours = operatingHours[dayName];
    if (hours && !isDayClosed(hours)) {
      // TODO: could also check holidays for the future date
      return { day: dayName, time: hours.open };
    }
  }
  return undefined;
}

/**
 * Format operating hours for display (e.g. in a schedule table)
 */
export function formatOperatingHours(operatingHours: OperatingHours | null | undefined): Array<{ day: string; hours: string }> {
  if (!operatingHours) return [];

  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return dayOrder.map(day => {
    const hours = operatingHours[day];
    if (!hours || isDayClosed(hours)) {
      return { day, hours: 'Closed' };
    }
    return { day, hours: `${hours.open} - ${hours.close}` };
  });
}

/**
 * Capitalize first letter
 */
export function capitalizeDay(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/**
 * Default operating hours (Mon-Fri 08:00-17:00, Sat 09:00-13:00, Sun closed)
 */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  monday: { open: '08:00', close: '17:00' },
  tuesday: { open: '08:00', close: '17:00' },
  wednesday: { open: '08:00', close: '17:00' },
  thursday: { open: '08:00', close: '17:00' },
  friday: { open: '08:00', close: '17:00' },
  saturday: { open: '09:00', close: '13:00' },
  sunday: { open: '00:00', close: '00:00' },
};
