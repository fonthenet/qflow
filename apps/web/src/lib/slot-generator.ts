/**
 * Centralized Slot Generator
 * Single source of truth for ALL slot generation across the app.
 * Used by: booking-slots API, appointment-actions, booking-form, messaging-commands.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getDateStartIso, getDateEndIso } from '@/lib/office-day';

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
 * Get the day-of-week name from a date string.
 */
function getDayOfWeek(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
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
    .select('id, operating_hours, timezone, organization_id')
    .eq('id', officeId)
    .single();

  if (!office) {
    return emptyResult(officeId, date, 'Office not found');
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', office.organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 7);
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

  // ── Check date is within horizon ──
  const todayStr = new Date().toISOString().split('T')[0];
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

  if (dayHours === null) {
    // Explicitly closed this day
    return { officeId, date, slots: [], meta: { ...baseMeta, office_closed: true } };
  }

  if (!dayHours) {
    // Fallback to default hours
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
  const tz = (office as any).timezone ?? undefined;
  const startOfDay = getDateStartIso(date, tz);
  const endOfDay = getDateEndIso(date, tz);

  const { data: existingAppointments } = await supabase
    .from('appointments')
    .select('scheduled_at')
    .eq('office_id', officeId)
    .eq('service_id', serviceId)
    .neq('status', 'cancelled')
    .gte('scheduled_at', startOfDay)
    .lte('scheduled_at', endOfDay);

  // Count bookings per slot
  const slotBookingCounts = new Map<string, number>();
  let totalDayBookings = 0;
  for (const a of existingAppointments ?? []) {
    const d = new Date(a.scheduled_at);
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
      .neq('status', 'cancelled')
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', endOfDay);
    totalDayAllServices = allDayAppts?.length ?? 0;
  }

  const dailyLimitReached = dailyTicketLimit > 0 && totalDayAllServices >= dailyTicketLimit;

  // ── 8. Filter slots ──
  const now = new Date();
  const isToday = date === todayStr;
  const minLeadMs = minLeadHours * 60 * 60 * 1000;

  const availableSlots: AvailableSlot[] = [];

  for (const slot of allSlots) {
    // Skip blocked slots
    if (isSlotBlocked(slot, blockedData)) continue;

    // Skip past slots (with lead time buffer)
    if (isToday) {
      const slotDate = new Date(`${date}T${slot}:00`);
      if (slotDate.getTime() <= now.getTime() + minLeadMs) continue;
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
 */
export async function getAvailableDates(
  officeId: string,
  serviceId: string,
  staffId?: string,
  maxDates: number = 7,
): Promise<{ date: string; slotCount: number }[]> {
  const todayStr = new Date().toISOString().split('T')[0];
  const supabase: any = createAdminClient();

  // Get booking horizon
  const { data: office } = await supabase
    .from('offices')
    .select('organization_id')
    .eq('id', officeId)
    .single();

  if (!office) return [];

  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', office.organization_id)
    .single();

  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  const horizonDays = Number(orgSettings.booking_horizon_days ?? 7);

  const results: { date: string; slotCount: number }[] = [];
  const today = new Date(todayStr + 'T12:00:00');

  for (let i = 0; i <= horizonDays && results.length < maxDates; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    const result = await getAvailableSlots({
      officeId,
      serviceId,
      date: dateStr,
      staffId,
    });

    if (result.slots.length > 0) {
      results.push({ date: dateStr, slotCount: result.slots.length });
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
