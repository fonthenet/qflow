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
  /**
   * Restaurant reservations only: the party size the caller intends to
   * book. Drives cover-cap math (a slot is "full" when adding this
   * party would exceed covers_per_interval). Defaults to 2 when omitted.
   */
  partySize?: number;
}

export interface AvailableSlot {
  time: string;      // HH:MM
  remaining: number; // spots left
  total: number;     // total capacity (slots_per_interval)
  /**
   * True when the slot can be booked. When `false`, the slot is still
   * returned so UIs can render it as "taken" and give the customer a
   * full picture of the day's schedule — but the booking flow must
   * reject it. Callers that only need bookable slots should filter
   * on `available !== false`.
   */
  available: boolean;
  /** Why the slot is unavailable. Only set when `available === false`. */
  reason?: 'taken' | 'daily_limit';
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
  const { officeId, serviceId, date, staffId, partySize } = params;
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
  const officeSettingsEarly = ((office.settings as Record<string, any>) ?? {});
  // Use org-level timezone as single source of truth
  const orgTimezone: string = org?.timezone || 'Africa/Algiers';
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 90);
  const slotDurationMinutes = Number(orgSettings.slot_duration_minutes ?? 30);
  const slotsPerInterval = Number(orgSettings.slots_per_interval ?? 1);
  // Restaurant reservations: cover-cap model gated by business_category.
  const businessCategory: string = typeof orgSettings.business_category === 'string'
    ? orgSettings.business_category
    : '';
  const isRestaurantOrg = businessCategory === 'restaurant'
    || businessCategory === 'cafe'
    || businessCategory === 'bar';
  const coversPerInterval = Number(orgSettings.covers_per_interval ?? 20);
  const turnMinutes = {
    small: Number(orgSettings.reservation_turn_minutes?.small ?? 90),
    medium: Number(orgSettings.reservation_turn_minutes?.medium ?? 120),
    large: Number(orgSettings.reservation_turn_minutes?.large ?? 150),
    xlarge: Number(orgSettings.reservation_turn_minutes?.xlarge ?? 180),
  };
  const turnMinutesFor = (p: number): number => {
    if (!p || p <= 2) return turnMinutes.small;
    if (p <= 4) return turnMinutes.medium;
    if (p <= 6) return turnMinutes.large;
    return turnMinutes.xlarge;
  };
  const requestedPartySize = isRestaurantOrg
    ? Math.max(1, Math.min(50, Number(partySize ?? 2)))
    : 0;
  const dailyTicketLimit = Number(orgSettings.daily_ticket_limit ?? 0);
  const allowCancellation = Boolean(orgSettings.allow_cancellation ?? false);
  const minLeadHours = Number(orgSettings.min_booking_lead_hours ?? 1);
  // "Show taken slots" is ON by default for every business (including
  // new signups) — customers see the full day's schedule with booked
  // slots marked as taken, which builds trust and speeds decisions.
  // Any org/office that prefers to hide load can set hide_taken_slots
  // to true in their settings JSON (office overrides org).
  const hideTakenSlots = officeSettingsEarly.hide_taken_slots === true
    ? true
    : orgSettings.hide_taken_slots === true
      ? true
      : false;

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
  const officeSettings = officeSettingsEarly;
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

  // For restaurants: cover cap is office-wide (not per-service), and we
  // need to pull overlapping reservations that started before startOfDay
  // (a party seated at 23:30 yesterday with 180-min turn would still hold
  // covers into today). Widen the lower bound by max turn time.
  const maxTurnMinutes = Math.max(
    turnMinutes.small,
    turnMinutes.medium,
    turnMinutes.large,
    turnMinutes.xlarge,
  );
  const widenedStart = isRestaurantOrg
    ? new Date(new Date(startOfDay).getTime() - maxTurnMinutes * 60 * 1000).toISOString()
    : startOfDay;

  // Salon-style detection — drives whether we partition slot availability
  // per-stylist. Mirrors isSalonCategory() in @qflo/shared without
  // pulling the import for SSR cost / cycle reasons.
  const isSalonOrg =
    businessCategory === 'beauty'
    || businessCategory === 'salon'
    || businessCategory === 'barber'
    || businessCategory === 'barbershop'
    || businessCategory === 'hair_salon'
    || businessCategory === 'nail_salon'
    || businessCategory === 'nails'
    || businessCategory === 'spa';

  const existingAppointmentsQuery = supabase
    .from('appointments')
    // Always pull staff_id for salon orgs so the per-stylist
    // partitioning below works. Non-salon flows ignore the column.
    .select(isRestaurantOrg ? 'scheduled_at, party_size' : 'scheduled_at, staff_id')
    .eq('office_id', officeId)
    // Only cancelled/no_show/declined free up a slot — completed appointments
    // still occupy the time slot (the patient was seen at that time).
    .not('status', 'in', '(cancelled,no_show,declined)')
    .gte('scheduled_at', widenedStart)
    .lte('scheduled_at', endOfDay);
  if (!isRestaurantOrg) {
    existingAppointmentsQuery.eq('service_id', serviceId);
  }
  // When the caller asks for a SPECIFIC stylist's calendar, narrow the
  // appointment fetch to that stylist's bookings only. A slot booked
  // with Marie has zero effect on Karim's availability — that's the
  // whole point of the multi-stylist model.
  if (staffId && !isRestaurantOrg) {
    existingAppointmentsQuery.eq('staff_id', staffId);
  }
  const { data: existingAppointments } = await existingAppointmentsQuery;

  // ── Salon: count of qualified stylists for this service ──
  // When no specific stylist was picked AND we're a salon-style org,
  // capacity per slot = number of stylists who can do this service,
  // are on the floor, work that day at that hour, AND haven't been
  // booked at that time. We pull the qualified set once with their
  // work_schedules so the slot loop below can filter per-slot in O(1).
  let qualifiedStylistIds: string[] = [];
  // Map<staffId, work_schedule jsonb> — schedules for the qualified
  // set. Stylists missing from the map (or with no schedule for the
  // day) inherit the office's operating hours.
  const stylistSchedules: Map<string, Record<string, { open: string; close: string } | null> | null> = new Map();
  if (isSalonOrg && !staffId && !isRestaurantOrg) {
    // 1. Active staff at this office (potential stylists)
    const { data: allStaff } = await supabase
      .from('staff')
      .select('id, availability_status, availability_until, work_schedule')
      .eq('office_id', officeId)
      .eq('is_active', true);
    const onFloorRows = (allStaff ?? []).filter((s: any) => {
      // Honour soft-expiry: a break that's past due treats the
      // stylist as available again automatically.
      if (s.availability_status === 'available') return true;
      if (s.availability_until) {
        const t = Date.parse(s.availability_until);
        if (Number.isFinite(t) && t < Date.now()) return true;
      }
      return false;
    }) as Array<{ id: string; work_schedule: any }>;
    const onFloor = onFloorRows.map((s) => s.id);

    if (onFloor.length > 0) {
      // 2. Filter by staff_services matrix. Empty-set fallback —
      //    a stylist with NO rows can do every service.
      const { data: matrix } = await supabase
        .from('staff_services')
        .select('staff_id, service_id, is_active')
        .in('staff_id', onFloor);
      const allRows = (matrix ?? []).filter((r: any) => r.is_active !== false);
      const specialised = new Set<string>(allRows.map((r: any) => r.staff_id));
      const canDoThis = new Set<string>(
        allRows
          .filter((r: any) => r.service_id === serviceId)
          .map((r: any) => r.staff_id),
      );
      qualifiedStylistIds = onFloor.filter((id) => !specialised.has(id) || canDoThis.has(id));
      // Index the schedules so the slot loop reads them in O(1).
      for (const r of onFloorRows) {
        if (qualifiedStylistIds.includes(r.id)) {
          stylistSchedules.set(r.id, r.work_schedule ?? null);
        }
      }
    }
  }

  // Count bookings per slot (using office timezone, not server UTC).
  // Guard against malformed rows (missing/invalid scheduled_at) so one
  // bad row can't throw from Intl.DateTimeFormat and take the whole
  // booking grid down.
  const slotBookingCounts = new Map<string, number>();
  let totalDayBookings = 0;
  // For restaurant orgs: keep the full list with timestamps and party sizes
  // so we can compute cover overlap per candidate slot below.
  const restaurantReservations: { startMs: number; endMs: number; covers: number }[] = [];
  // Per-stylist taken-slot index. For salon-style orgs without a
  // specific staffId, capacity at each slot is the COUNT of qualified
  // stylists who don't have that slot taken — Marie's 3pm doesn't
  // block Karim's 3pm. Built unconditionally; only used for the
  // salon "any available" path below.
  const slotsTakenByStylist: Map<string, Set<string>> = new Map();

  for (const a of existingAppointments ?? []) {
    if (!a?.scheduled_at) continue;
    const d = new Date(a.scheduled_at);
    if (isNaN(d.getTime())) continue;
    if (isRestaurantOrg) {
      const covers = Math.max(1, Number((a as any).party_size ?? 1));
      const startMs = d.getTime();
      const endMs = startMs + turnMinutesFor(covers) * 60 * 1000;
      restaurantReservations.push({ startMs, endMs, covers });
      // Only count towards today's totals if it actually lands on this day.
      if (startMs >= new Date(startOfDay).getTime() && startMs <= new Date(endOfDay).getTime()) {
        totalDayBookings++;
      }
    } else {
      const t = timeInTz(d, orgTimezone);
      slotBookingCounts.set(t, (slotBookingCounts.get(t) ?? 0) + 1);
      totalDayBookings++;
      const sid = (a as any).staff_id as string | null;
      if (sid) {
        const taken = slotsTakenByStylist.get(sid) ?? new Set<string>();
        taken.add(t);
        slotsTakenByStylist.set(sid, taken);
      }
    }
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
    // Skip blocked slots outright — these aren't "taken", the business
    // deliberately made them unavailable (break, maintenance, etc.)
    // and customers shouldn't see them at all.
    if (isSlotBlocked(slot, blockedData)) continue;

    // Skip past slots (with lead time buffer) — no value to the customer.
    if (isToday) {
      const slotMs = new Date(`${date}T${slot}:00Z`).getTime();
      if (slotMs <= nowMs + minLeadMs) continue;
    }

    // Check capacity.
    // Restaurants use the cover-cap / turn-time model.
    // Salons (no specific stylist picked) use the qualified-stylist
    // model: capacity = count of stylists who can do this service
    // and are on the floor; booked = count whose slot is already
    // taken. A 5-stylist shop has 5 parallel calendars, so 3pm is
    // available to up to 5 customers simultaneously (each picks a
    // different stylist) until all 5 are booked at that hour.
    // Salon + specific stylist: that stylist's calendar only —
    // capacity 1, booked 0 or 1 based on whether they have an
    // appointment at this time.
    // Everything else: legacy per-slot count against slots_per_interval.
    let booked: number;
    let capacity: number;
    if (isRestaurantOrg) {
      const slotStartMs = new Date(`${date}T${slot}:00Z`).getTime();
      const slotEndMs = slotStartMs + turnMinutesFor(requestedPartySize) * 60 * 1000;
      let covers = 0;
      for (const r of restaurantReservations) {
        if (r.startMs < slotEndMs && r.endMs > slotStartMs) covers += r.covers;
      }
      booked = covers;
      capacity = coversPerInterval;
    } else if (isSalonOrg && staffId) {
      // Specific-stylist booking: existingAppointments was already
      // filtered by staffId — slot is taken iff there's a row for it.
      booked = slotBookingCounts.get(slot) ?? 0;
      capacity = 1;
    } else if (isSalonOrg && qualifiedStylistIds.length > 0) {
      // "Any available" — count free stylists at this slot.
      // A stylist counts toward capacity ONLY when they actually
      // work at this hour on this day (per their work_schedule).
      // Marie's Tuesday-only schedule means she contributes 0 to
      // Wednesday's 3pm capacity but 1 to Tuesday's 3pm capacity.
      let workingCount = 0;
      let freeCount = 0;
      for (const sid of qualifiedStylistIds) {
        const sched = stylistSchedules.get(sid) ?? null;
        const day = sched ? sched[dayOfWeek] : undefined;
        // Schedule semantics:
        //   null      → explicitly off this day (excluded)
        //   undefined → no per-stylist override → inherit office hours
        //               → working during the slot since the slot was
        //                 already filtered to the office's day hours
        //   {open,close} → working only during that window
        if (day === null) continue;
        if (day && (slot < day.open || slot >= day.close)) continue;
        workingCount++;
        const taken = slotsTakenByStylist.get(sid);
        if (!taken || !taken.has(slot)) freeCount++;
      }
      capacity = workingCount;
      booked = capacity - freeCount;
    } else {
      booked = slotBookingCounts.get(slot) ?? 0;
      capacity = slotsPerInterval;
    }
    const remaining = isRestaurantOrg
      ? capacity - booked - requestedPartySize + 1 // +1 so remaining represents "can you still fit this party"
      : capacity - booked;
    const isTaken = isRestaurantOrg
      ? booked + requestedPartySize > capacity
      : remaining <= 0;

    // Daily-limit-reached makes EVERY remaining slot effectively taken.
    // When the limit is reached we still include the slots so the
    // customer can see the full day's timeline (marked unavailable).
    if (dailyLimitReached) {
      if (hideTakenSlots) continue;
      availableSlots.push({
        time: slot,
        remaining: 0,
        total: isRestaurantOrg ? coversPerInterval : slotsPerInterval,
        available: false,
        reason: 'daily_limit',
      });
      continue;
    }

    if (isTaken) {
      if (hideTakenSlots) continue;
      availableSlots.push({
        time: slot,
        remaining: 0,
        total: isRestaurantOrg ? coversPerInterval : slotsPerInterval,
        available: false,
        reason: 'taken',
      });
      continue;
    }

    availableSlots.push({
      time: slot,
      remaining: isRestaurantOrg ? Math.max(0, capacity - booked) : remaining,
      total: isRestaurantOrg ? coversPerInterval : slotsPerInterval,
      available: true,
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
