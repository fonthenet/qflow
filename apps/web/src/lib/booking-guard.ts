/**
 * Single source of truth for "can this booking be created?"
 *
 * EVERY path that inserts an appointments row MUST call `assertBookingAllowed`
 * (or `checkBookingAllowed` if it wants to handle the rejection itself).
 * This covers:
 *  - /api/book-appointment (web portal, mobile app, in-house)
 *  - lib/messaging-commands confirmBooking (WhatsApp / Messenger)
 *  - lib/actions/appointment-actions createAppointment (admin UI)
 *
 * Without this, an attacker or a stale client can bypass the UI and insert an
 * appointment for a closed business, an `always_closed` override, a disabled
 * booking mode, or a slot outside operating hours.
 */

import { getAvailableSlots } from './slot-generator';

export type BookingGuardReason =
  | 'booking_disabled'
  | 'always_closed'
  | 'office_closed'
  | 'holiday'
  | 'daily_limit_reached'
  | 'slot_unavailable'
  | 'outside_operating_hours';

export interface BookingGuardResult {
  ok: boolean;
  reason?: BookingGuardReason;
  message?: string;
  /** HTTP status code we'd return if this were a route handler. */
  status?: number;
}

export interface BookingGuardInput {
  officeId: string;
  serviceId: string;
  /** Scheduled-at in the office-local clock — "YYYY-MM-DDTHH:mm[:ss]". */
  scheduledAt: string;
  staffId?: string | null;
  /** Set true when a staff member is creating the booking on behalf of a walk-in.
   *  In-house still honors always_closed + booking_mode=disabled, but we allow
   *  staff to override `office_closed` for a specific day (to rescue late
   *  arrivals). Defaults to false. */
  isInHouse?: boolean;
}

/** Returns `{ ok: true }` when the booking is allowed, otherwise `{ ok: false, reason, message, status }`. */
export async function checkBookingAllowed(input: BookingGuardInput): Promise<BookingGuardResult> {
  const dateStr = input.scheduledAt.split('T')[0];
  const timePart = input.scheduledAt.split('T')[1] || '00:00';
  const timeStr = timePart.substring(0, 5); // HH:MM

  const availability = await getAvailableSlots({
    officeId: input.officeId,
    serviceId: input.serviceId,
    date: dateStr,
    staffId: input.staffId ?? undefined,
  });

  // ── Hard blocks — apply to ALL paths, including in-house ──────────────────
  if (availability.meta.booking_mode === 'disabled') {
    return {
      ok: false,
      reason: 'booking_disabled',
      message: 'Booking is currently disabled for this business',
      status: 403,
    };
  }

  // `always_closed` is exposed via an empty slot set + always_closed flag in meta;
  // slot-generator bakes it into office_closed so we still block via office_closed,
  // but surface a clearer reason when the override is set.
  const meta = availability.meta as { [k: string]: unknown };
  if (meta.always_closed === true) {
    return {
      ok: false,
      reason: 'always_closed',
      message: 'This business is currently closed and not accepting bookings',
      status: 403,
    };
  }

  // ── Day-level blocks — in-house staff can override office_closed ──────────
  if (availability.meta.office_closed && !input.isInHouse) {
    return {
      ok: false,
      reason: 'office_closed',
      message: 'Office is closed on this date',
      status: 400,
    };
  }

  if (availability.meta.is_holiday && !input.isInHouse) {
    return {
      ok: false,
      reason: 'holiday',
      message: 'This date is a holiday',
      status: 400,
    };
  }

  if (availability.meta.daily_limit_reached) {
    return {
      ok: false,
      reason: 'daily_limit_reached',
      message: 'Daily booking limit reached for this date',
      status: 409,
    };
  }

  // ── Slot-level check — in-house staff can still book any time in the day ──
  if (!input.isInHouse) {
    const slotMatch = availability.slots.find((s) => s.time === timeStr);
    if (!slotMatch || slotMatch.available === false) {
      return {
        ok: false,
        reason: 'slot_unavailable',
        message: 'This time slot is not available',
        status: 409,
      };
    }
  }

  return { ok: true };
}

/** Throws a BookingGuardError if booking is not allowed. Convenience wrapper
 *  for callers that want to propagate the reason as an exception. */
export async function assertBookingAllowed(input: BookingGuardInput): Promise<void> {
  const result = await checkBookingAllowed(input);
  if (!result.ok) {
    throw new BookingGuardError(
      result.message ?? 'Booking is not allowed',
      result.reason ?? 'slot_unavailable',
      result.status ?? 400,
    );
  }
}

export class BookingGuardError extends Error {
  constructor(
    message: string,
    public readonly reason: BookingGuardReason,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BookingGuardError';
  }
}
