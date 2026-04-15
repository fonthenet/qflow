/**
 * Centralized Slot Generator
 * Single source of truth for ALL slot generation across the app.
 * Used by: booking-slots API, appointment-actions, booking-form, messaging-commands.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getDateStartIso, getDateEndIso } from '@/lib/office-day';

/** Get current date string (YYYY-MM-DD) in a specific timezone */
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date());
}

/** Get HH:MM from a Date in a specific timezone */
function timeInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
  return `${parts.find(p => p.type === 'hour')?.value ?? '00'}:${parts.find(p => p.type === 'minute')?.value ?? '00'}`;
}

/** Get "now" truncated to the current minute in a specific timezone, as epoch ms */
function nowTruncatedInTz(tz: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
  // Build an explicit UTC string from the office-timezone-aware parts.
  // Both this value and the slot time strings use 'Z' suffix for consistency,
  // so the comparison is always apples-to-apples regardless of server timezone.
  return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`).getTime();
}

// ── Types ────────────────────────────────────────────────────────────

export interface SlotGeneratorParams {
  officeId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  staffId?: string; // optional: filter by staff availability
}

export interface AvailableSlot {
  time: string;      // HH:MM
  remaining: number; // spots left
  total: number;     // total capacity (slots_per_interval)
}

export interface SlotGeneratorResult {
  officeId: string;
  date: string;
  slots: AvailableSlot[];
  meta: {
    booking_mode: string;
    booking_horizon_days: number;
    slot_duration_minutes: number;
    slots_per_interval: number;
    daily_ticket_limit: number; // 0 = no limit
    daily_booking_count: number;
    daily_limit_reached: boolean;
    allow_cancellation: boolean;
    office_closed: boolean;
    is_holiday: boolean;
  };
}

// ── Core slot generation ─────────────────────────────────────────────

/**
 * Generate time slots between open and close time at given interval.
 */
export function generateTimeSlots(
  openTime: string,
  closeTime: string,
  durationMinutes: number
): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  let h = openH, m = openM;

  while (h < closeH || (h === closeH && m < closeM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += durationMinutes;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }

  return slots;
}

/**
 * Check if a slot time falls within any blocked range.
 */
function isSlotBlocked(
  slotTime: string,
  blockedRanges: { start_time: string; end_time: string }[]
): boolean {
  return blockedRanges.some((b) => slotTime >= b.start_time && slotTime < b.end_time);
}

/**
 * Get the day-of-week name from a YYYY-MM-DD date string.
 * Uses UTC noon to avoid timezone ambiguity — deterministic and safe.
 */
function getDayOfWeek(date: string): string {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const d = new Date(date + 'T12:00:00Z');
  return DAYS[d.getUTCDay()];
}

// ── Main generator ───────────────────────────────────────────────────

/**
 * Generate available slots for a given office, service, and date.
 * This is the single source of truth for slot availability.
 *
 * Checks:
 * 1. Office operating hours for the day
 * 2. Staff work schedule (if staffId provided)
 * 3. Office holidays
 * 4. Blocked slots
 * 5. Existing appointments (capacity check)
 * 6. Daily ticket limit
 * 7. Past time filter (if booking for today)
 * 8. Minimum lead time
 */
export async function getAvailableSlots(
  params: SlotGeneratorParams
): Promise<SlotGeneratorResult> {
  const { officeId, serviceId, date, staffId } = params;
  // Cast to any: this module uses tables/columns not yet in generated types
  // (office_holidays, blocked_slots, staff.work_schedule, etc.)
  const supabase: any = createAdminClient();

  // ── 1. Fetch office + org settings ──
  const { data: office } = await supabase
    .from('offices')
    .select('id, operating_hours, timezone, organization_id, settings')
    .eq('id', officeId)
    .single();

  if (!office) {
    return emptyResult(officeId, date, 'Office not found');
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('settings, timezone')
    .eq('id', office.organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  // Use org-level timezone as single source of truth
  const orgTimezone: string = org?.timezone || 'Africa/Algiers';
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 90);
  const slotDurationMinutes = Number(orgSettings.slot_duration_minutes ?? 30);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);
  const dailyTicketLimit = Number(orgSettings.daily_ticket_limit ?? 0);
  const allowCancellation = Boolean(orgSettings.allow_cancellation ?? false);
  const minLeadHours = Number(orgSettings.min_booking_lead_hours ?? 1);

  const baseMeta = {
    booking_mode: bookingMode,
    booking_horizon_days: bookingHorizonDays,
    slot_duration_minutes: slotDurationMinutes,
    slots_per_interval: slotsPerInterval,
    daily_ticket_limit: dailyTicketLimit,
    daily_booking_count: 0,
    daily_limit_reached: false,
    allow_cancellation: allowCancellation,
    office_closed: false,
    is_holiday: false,
  };

  // ── Check booking mode ──
  if (bookingMode === 'disabled') {
    return { officeId, date, slots: [], meta: { ...baseMeta, office_closed: true } };
  }

  // ── Resolve visit intake override mode ──
  const officeSettings = ((office.settings as Record<string, any>) ?? {});
  const visitIntakeOverrideMode =
    typeof orgSettings.visit_intake_override_mode === 'string'
      ? orgSettings.visit_intake_override_mode
      : typeof officeSettings.visit_intake_override_mode === 'string'
        ? officeSettings.visit_intake_override_mode
        : 'business_hours';

  // If always_closed, no slots at all
  if (visitIntakeOverrideMode === 'always_closed') {
    return { officeId, date, slots: [], meta: { ...baseMeta, office_closed: true } };
  }

  const isAlwaysOpen = visitIntakeOverrideMode === 'always_open';

  // ── Check date is within horizon (in office timezone, not server UTC) ──
  const todayStr = todayInTz(orgTimezone);
  const maxD = new Date(todayStr + 'T12:00:00');
  maxD.setDate(maxD.getDate() + bookingHorizonDays);
  const maxDateStr = maxD.toISOString().split('T')[0];
  if (date < todayStr || date > maxDateStr) {
    return { officeId, date, slots: [], meta: baseMeta };
  }

  // ── 2. Check holidays ──
  let isHoliday = false;
  try {
    const { data: holidays } = await supabase
      .from('office_holidays')
      .select('id, is_full_day')
      .eq('office_id', officeId)
      .eq('holiday_date', date);

    if (holidays && holidays.length > 0) {
      const fullDay = holidays.some((h: any) => h.is_full_day);
      if (fullDay) {
        return { officeId, date, slots: [], meta: { ...baseMeta, is_holiday: true } };
      }
      isHoliday = true; // partial holiday — still generate slots
    }
  } catch {
    // Table may not exist
  }

  // ── 3. Get operating hours for the day ──
  const dayOfWeek = getDayOfWeek(date);
  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string } | null> | null) ?? {};
  let dayHours = operatingHours[dayOfWeek];

  if (dayHours === null || (dayHours && dayHours.open === '00:00' && dayHours.close === '00:00')) {
    // Day is marked as closed
    if (!isAlwaysOpen) {
      return { officeId, date, slots: [], meta: { ...baseMeta, office_closed: true } };
    }
    // always_open overrides: use default full-day hours
    dayHours = { open: '08:00', close: '20:00' };
  }

  if (!dayHours) {
    // No hours configured at all — use default hours
    dayHours = { open: '08:00', close: '17:00' };
  }

  // ── 4. If staff specified, intersect with staff work schedule ──
  let effectiveOpen = dayHours.open;
  let effectiveClose = dayHours.close;
  let effectiveDuration = slotDurationMinutes;

  if (staffId) {
    const { data: staff } = await supabase
      .from('staff')
      .select('work_schedule, default_slot_duration_minutes')
      .eq('id', staffId)
      .single();

    if (staff) {
      const staffSchedule = (staff.work_schedule as Record<string, { open: string; close: string } | null> | null) ?? {};
      const staffDay = staffSchedule[dayOfWeek];

      if (staffDay === null) {
        // Staff is off this day
        return { officeId, date, slots: [], meta: { ...baseMeta, office_closed: true } };
      }

      if (staffDay) {
        // Intersect: use the later open and earlier close
        effectiveOpen = staffDay.open > effectiveOpen ? staffDay.open : effectiveOpen;
        effectiveClose = staffDay.close < effectiveClose ? staffDay.close : effectiveClose;
      }

      if (staff.default_slot_duration_minutes) {
        effectiveDuration = staff.default_slot_duration_minutes;
      }
    }
  }

  // ── 5. Generate all possible time slots ──
  const allSlots = generateTimeSlots(effectiveOpen, effectiveClose, effectiveDuration);

  // ── 6. Fetch blocked slots ──
  let blockedData: { start_time: string; end_time: string }[] = [];
  try {
    const { data } = await supabase
      .from('blocked_slots')
      .select('start_time, end_time')
      .eq('office_id', officeId)
      .eq('blocked_date', date);
    blockedData = (data ?? []) as { start_time: string; end_time: string }[];
  } catch {
    // Table may not exist yet
  }

  // ── 7. Fetch existing appointments for date ──
  const startOfDay = getDateStartIso(date, orgTimezone);
  const endOfDay = getDateEndIso(date, orgTimezone);

  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    // Only cancelled/no_show/declined free up a slot — completed appointments
    // still occupy the time slot (the patient was seen at that time).
    .not('status', 'in', '(cancelled,no_show,declined)')
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay);

  // Count bookings per slot (using office timezone, not server UTC)
  const slotBookingCounts = new Map<string, number>();
  let totalDayBookings = 0;
  for (const a of existingAppointments ?? []) {
    const t = timeInTz(new Date(a.scheduled_at), orgTimezone);
    slotBookingCounts.set(t, (slotBookingCounts.get(t) ?? 0) + 1);
    totalDayBookings++;
  }

  // Also count ALL appointments for the day (all services) for daily limit
  let totalDayAllServices = totalDayBookings;
  if (dailyTicketLimit > 0) {
    const { data: allDayAppts } = await supabase
      .from('appointments')
      .select('id')
      .eq('office_id', officeId)
      .not('status', 'in', '(cancelled,no_show,declined)')
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', endOfDay);
    totalDayAllServices = allDayAppts?.length ?? 0;
  }

  const dailyLimitReached = dailyTicketLimit > 0 && totalDayAllServices >= dailyTicketLimit;

  // ── 8. Filter slots ──
  // Truncate now to the start of the current minute in the OFFICE timezone
  // so a slot at 09:30 remains bookable until 09:31 (not rejected at 09:30:01).
  const nowMs = nowTruncatedInTz(orgTimezone);
  const isToday = date === todayStr;
  const minLeadMs = minLeadHours * 60 * 60 * 1000;

  const availableSlots: AvailableSlot[] = [];

  for (const slot of allSlots) {
    // Skip blocked slots
    if (isSlotBlocked(slot, blockedData)) continue;

    // Skip past slots (with lead time buffer)
    if (isToday) {
      const slotMs = new Date(`${date}T${slot}:00Z`).getTime();
      if (slotMs <= nowMs + minLeadMs) continue;
    }

    // Skip if daily limit reached
    if (dailyLimitReached) continue;

    // Check capacity
    const booked = slotBookingCounts.get(slot) ?? 0;
    const remaining = slotsPerInterval - booked;
    if (remaining <= 0) continue;

    availableSlots.push({
      time: slot,
      remaining,
      total: slotsPerInterval,
    });
  }

  return {
    officeId,
    date,
    slots: availableSlots,
    meta: {
      ...baseMeta,
      daily_booking_count: totalDayAllServices,
      daily_limit_reached: dailyLimitReached,
      is_holiday: isHoliday,
    },
  };
}

/**
 * Get available dates within the booking horizon.
 * Returns dates that have at least one available slot.
 * Useful for WhatsApp booking flow and calendar display.
 *
 * OPTIMIZED: fetches all data (office, org, holidays, blocked slots,
 * appointments) in bulk queries up front, then iterates locally.
 * This reduces ~400 DB queries to ~6 regardless of horizon length.
 */
export async function getAvailableDates(
  officeId: string,
  serviceId: string,
  staffId?: string,
  maxDates?: number,
): Promise<{ date: string; slotCount: number }[]> {
  const supabase: any = createAdminClient();

  // ── 1. Fetch office + org in parallel ──
  const [{ data: office }, { data: org }] = await Promise.all([
    supabase
      .from('offices')
      .select('id, operating_hours, organization_id, settings')
      .eq('id', officeId)
      .single() as Promise<any>,
    // We need org_id first, but offices table has it — fetch org separately
    // after we have the office. For now fetch office first.
    { data: null } as any,
  ]);

  if (!office) return [];

  const { data: orgData } = await supabase
    .from('organizations')
    .select('settings, timezone')
    .eq('id', office.organization_id)
    .single();

  const orgSettings = (orgData?.settings as Record<string, any> | null) ?? {};
  const horizonDays = Number(orgSettings.booking_horizon_days ?? 90);
  const tz: string = orgData?.timezone || 'Africa/Algiers';
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const slotDurationMinutes = Number(orgSettings.slot_duration_minutes ?? 30);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);
  const dailyTicketLimit = Number(orgSettings.daily_ticket_limit ?? 0);
  const minLeadHours = Number(orgSettings.min_booking_lead_hours ?? 1);

  if (bookingMode === 'disabled') return [];

  const officeSettings = ((office.settings as Record<string, any>) ?? {});
  const visitIntakeOverrideMode =
    typeof orgSettings.visit_intake_override_mode === 'string'
      ? orgSettings.visit_intake_override_mode
      : typeof officeSettings.visit_intake_override_mode === 'string'
        ? officeSettings.visit_intake_override_mode
        : 'business_hours';
  if (visitIntakeOverrideMode === 'always_closed') return [];
  const isAlwaysOpen = visitIntakeOverrideMode === 'always_open';

  // Business-local "today" as YYYY-MM-DD.
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const yyyy = todayParts.find(p => p.type === 'year')?.value ?? '1970';
  const mm = todayParts.find(p => p.type === 'month')?.value ?? '01';
  const dd = todayParts.find(p => p.type === 'day')?.value ?? '01';
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const todayAnchor = new Date(`${todayStr}T12:00:00Z`);

  // Compute date range
  const startDate = new Date(todayAnchor);
  startDate.setUTCDate(startDate.getUTCDate() + 1); // tomorrow
  const endDate = new Date(todayAnchor);
  endDate.setUTCDate(endDate.getUTCDate() + horizonDays);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // UTC range for appointment queries
  const rangeStartIso = getDateStartIso(startDateStr, tz);
  const rangeEndIso = getDateEndIso(endDateStr, tz);

  // ── 2. Batch-fetch holidays, blocked slots, appointments, staff ──
  const [holidaysRes, blockedRes, apptsRes, allApptsRes, staffRes] = await Promise.all([
    supabase
      .from('office_holidays')
      .select('holiday_date, is_full_day')
      .eq('office_id', officeId)
      .gte('holiday_date', startDateStr)
      .lte('holiday_date', endDateStr)
      .then((r: any) => r)
      .catch(() => ({ data: [] })),
    supabase
      .from('blocked_slots')
      .select('blocked_date, start_time, end_time')
      .eq('office_id', officeId)
      .gte('blocked_date', startDateStr)
      .lte('blocked_date', endDateStr)
      .then((r: any) => r)
      .catch(() => ({ data: [] })),
    // Appointments for specific service (capacity check)
    supabase
      .from('appointments')
      .select('scheduled_at')
      .eq('office_id', officeId)
      .eq('service_id', serviceId)
      .not('status', 'in', '(cancelled,no_show,declined)')
      .gte('scheduled_at', rangeStartIso)
      .lte('scheduled_at', rangeEndIso),
    // All appointments for daily limit (only if limit is set)
    dailyTicketLimit > 0
      ? supabase
          .from('appointments')
          .select('scheduled_at')
          .eq('office_id', officeId)
          .not('status', 'in', '(cancelled,no_show,declined)')
          .gte('scheduled_at', rangeStartIso)
          .lte('scheduled_at', rangeEndIso)
      : Promise.resolve({ data: [] }),
    // Staff schedule (only if staffId provided)
    staffId
      ? supabase
          .from('staff')
          .select('work_schedule, default_slot_duration_minutes')
          .eq('id', staffId)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  // ── 3. Index bulk data by date for O(1) lookup ──
  const fullDayHolidays = new Set<string>();
  const partialHolidays = new Set<string>();
  for (const h of holidaysRes.data ?? []) {
    if (h.is_full_day) fullDayHolidays.add(h.holiday_date);
    else partialHolidays.add(h.holiday_date);
  }

  const blockedByDate = new Map<string, { start_time: string; end_time: string }[]>();
  for (const b of blockedRes.data ?? []) {
    const arr = blockedByDate.get(b.blocked_date) ?? [];
    arr.push({ start_time: b.start_time, end_time: b.end_time });
    blockedByDate.set(b.blocked_date, arr);
  }

  // Index service appointments by date → slot time
  const apptsByDateSlot = new Map<string, Map<string, number>>();
  for (const a of apptsRes.data ?? []) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(a.scheduled_at));
    const t = timeInTz(new Date(a.scheduled_at), tz);
    if (!apptsByDateSlot.has(d)) apptsByDateSlot.set(d, new Map());
    const slotMap = apptsByDateSlot.get(d)!;
    slotMap.set(t, (slotMap.get(t) ?? 0) + 1);
  }

  // Index all appointments by date for daily limit
  const allApptsByDate = new Map<string, number>();
  if (dailyTicketLimit > 0) {
    for (const a of (allApptsRes.data ?? [])) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(a.scheduled_at));
      allApptsByDate.set(d, (allApptsByDate.get(d) ?? 0) + 1);
    }
  }

  const staff = staffRes?.data;
  const staffSchedule = staff?.work_schedule as Record<string, { open: string; close: string } | null> | null;
  const staffDuration = staff?.default_slot_duration_minutes;

  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string } | null> | null) ?? {};

  // For "today" time filtering
  const nowMs = nowTruncatedInTz(tz);
  const minLeadMs = minLeadHours * 60 * 60 * 1000;

  // ── 4. Iterate dates locally — no more DB queries ──
  const results: { date: string; slotCount: number }[] = [];
  const cap = maxDates ?? horizonDays;

  for (let i = 1; i <= horizonDays && results.length < cap; i++) {
    const d = new Date(todayAnchor);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    // Holiday check
    if (fullDayHolidays.has(dateStr)) continue;

    // Operating hours
    const dayOfWeek = getDayOfWeek(dateStr);
    let dayHours = operatingHours[dayOfWeek];

    if (dayHours === null || (dayHours && dayHours.open === '00:00' && dayHours.close === '00:00')) {
      if (!isAlwaysOpen) continue;
      dayHours = { open: '08:00', close: '20:00' };
    }
    if (!dayHours) dayHours = { open: '08:00', close: '17:00' };

    // Staff schedule intersection
    let effectiveOpen = dayHours.open;
    let effectiveClose = dayHours.close;
    let effectiveDuration = staffDuration ?? slotDurationMinutes;

    if (staffId && staffSchedule) {
      const staffDay = staffSchedule[dayOfWeek];
      if (staffDay === null) continue; // staff off
      if (staffDay) {
        effectiveOpen = staffDay.open > effectiveOpen ? staffDay.open : effectiveOpen;
        effectiveClose = staffDay.close < effectiveClose ? staffDay.close : effectiveClose;
      }
    }

    // Generate time slots
    const allSlots = generateTimeSlots(effectiveOpen, effectiveClose, effectiveDuration);
    const blocked = blockedByDate.get(dateStr) ?? [];
    const slotCounts = apptsByDateSlot.get(dateStr) ?? new Map<string, number>();
    const isToday = dateStr === todayStr;
    const dailyTotal = dailyTicketLimit > 0 ? (allApptsByDate.get(dateStr) ?? 0) : 0;
    const dailyLimitReached = dailyTicketLimit > 0 && dailyTotal >= dailyTicketLimit;

    let availCount = 0;
    for (const slot of allSlots) {
      if (isSlotBlocked(slot, blocked)) continue;
      if (isToday) {
        const slotMs = new Date(`${dateStr}T${slot}:00Z`).getTime();
        if (slotMs <= nowMs + minLeadMs) continue;
      }
      if (dailyLimitReached) continue;
      const booked = slotCounts.get(slot) ?? 0;
      if (slotsPerInterval - booked <= 0) continue;
      availCount++;
    }

    if (availCount > 0) {
      results.push({ date: dateStr, slotCount: availCount });
    }
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────

function emptyResult(officeId: string, date: string, _reason?: string): SlotGeneratorResult {
  return {
    officeId,
    date,
    slots: [],
    meta: {
      booking_mode: 'simple',
      booking_horizon_days: 7,
      slot_duration_minutes: 30,
      slots_per_interval: 1,
      daily_ticket_limit: 0,
      daily_booking_count: 0,
      daily_limit_reached: false,
      allow_cancellation: false,
      office_closed: false,
      is_holiday: false,
    },
  };
}
