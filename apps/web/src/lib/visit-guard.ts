/**
 * Single source of truth for "can this visitor take a ticket right now?"
 *
 * EVERY path that inserts a `tickets` row MUST call `assertVisitAllowed`
 * (or `checkVisitAllowed` to handle rejection itself). This covers:
 *  - /api/kiosk-ticket          (native kiosk, mobile app "instant book")
 *  - /api/join-queue            (mobile app remote join / virtual queue)
 *  - createPublicTicket         (web portal public ticket flow,
 *                                WhatsApp / Messenger ticket take)
 *
 * Without this, a stale client or a direct API caller can drop a ticket
 * for a business that is closed, on holiday, or has `always_closed`
 * override enabled.
 *
 * This is the ticket/walk-in counterpart to `booking-guard.ts`. Bookings
 * validate a future scheduled time against operating hours; visits
 * validate *now* against operating hours and the same always_closed /
 * booking_mode=disabled hard blocks.
 */

import { createAdminClient } from '@/lib/supabase/admin';

const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type VisitGuardReason =
  | 'visits_disabled'
  | 'always_closed'
  | 'closed_today'
  | 'before_hours'
  | 'after_hours';

export interface VisitGuardResult {
  ok: boolean;
  reason?: VisitGuardReason;
  message?: string;
  status?: number;
}

export interface VisitGuardInput {
  officeId: string;
  /** Set true when staff at the front desk creates the ticket on behalf of a
   *  walk-in. Still honors `always_closed` (the owner has explicitly frozen
   *  intake), but bypasses the operating-hours check so staff can serve
   *  late arrivals. Defaults to false. */
  isInHouse?: boolean;
}

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (value === 'Europe/Algiers') return 'Africa/Algiers';
  return value;
}

export function getBusinessHoursStatus(
  operatingHours: Record<string, { open: string; close: string }> | null,
  timezone: string | null | undefined,
) {
  const now = new Date();
  const normalizedTimezone = normalizeOfficeTimezone(timezone);
  let day: string;
  let time: string;

  try {
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: normalizedTimezone }).format(now);
    const d = new Date(dateKey + 'T12:00:00Z');
    day = DAYS_OF_WEEK[d.getUTCDay()];

    const timeFmt = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: normalizedTimezone,
    });
    const parts = timeFmt.formatToParts(now);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  } catch {
    const fallbackKey = now.toISOString().split('T')[0];
    const fd = new Date(fallbackKey + 'T12:00:00Z');
    day = DAYS_OF_WEEK[fd.getUTCDay()];
    time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  }

  if (!operatingHours || Object.keys(operatingHours).length === 0) {
    return { isOpen: true, reason: 'no_hours' as const, todayHours: null as { open: string; close: string } | null };
  }

  const todayHours = operatingHours[day];
  if (!todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00')) {
    return { isOpen: false, reason: 'closed_today' as const, todayHours: null as { open: string; close: string } | null };
  }

  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const currentMinutes = toMinutes(time);
  const openMinutes = toMinutes(todayHours.open);
  const closeMinutes = toMinutes(todayHours.close);

  if (currentMinutes < openMinutes) {
    return { isOpen: false, reason: 'before_hours' as const, todayHours };
  }
  if (currentMinutes >= closeMinutes) {
    return { isOpen: false, reason: 'after_hours' as const, todayHours };
  }

  return { isOpen: true, reason: 'open' as const, todayHours };
}

/** Returns `{ ok: true }` when a visitor may take a ticket now. */
export async function checkVisitAllowed(input: VisitGuardInput): Promise<VisitGuardResult> {
  const supabase = createAdminClient();

  const { data: office, error } = await supabase
    .from('offices')
    .select('id, settings, operating_hours, timezone, organization:organizations(settings, timezone)')
    .eq('id', input.officeId)
    .single();

  if (error || !office) {
    return {
      ok: false,
      reason: 'always_closed',
      message: error?.message ?? 'Office not found',
      status: 404,
    };
  }

  const orgSettings = (((office as any).organization?.settings) ?? {}) as Record<string, unknown>;
  const officeSettings = ((office as any).settings ?? {}) as Record<string, unknown>;
  const orgTz: string =
    (office as any).organization?.timezone || (office as any).timezone || 'Africa/Algiers';

  const overrideMode =
    (typeof orgSettings.visit_intake_override_mode === 'string'
      ? orgSettings.visit_intake_override_mode
      : typeof officeSettings.visit_intake_override_mode === 'string'
        ? officeSettings.visit_intake_override_mode
        : 'business_hours') as 'business_hours' | 'always_open' | 'always_closed';

  // ── Hard block — applies to ALL paths, including in-house ────────────
  if (overrideMode === 'always_closed') {
    return {
      ok: false,
      reason: 'always_closed',
      message: 'This business is not taking visits right now.',
      status: 403,
    };
  }

  if (overrideMode === 'always_open') {
    return { ok: true };
  }

  // In-house staff can serve late arrivals even when the operating-hours
  // window has closed. The explicit `always_closed` owner override above
  // still blocks them — that's a deliberate freeze, not an hours gap.
  if (input.isInHouse) {
    return { ok: true };
  }

  const operatingHours =
    ((office as any).operating_hours as Record<string, { open: string; close: string }> | null) ?? null;
  const status = getBusinessHoursStatus(operatingHours, orgTz);

  if (!status.isOpen) {
    if (status.reason === 'before_hours') {
      return {
        ok: false,
        reason: 'before_hours',
        message: `Opens at ${status.todayHours?.open ?? ''}`.trim(),
        status: 403,
      };
    }
    if (status.reason === 'after_hours') {
      return { ok: false, reason: 'after_hours', message: 'Closed for the day', status: 403 };
    }
    if (status.reason === 'closed_today') {
      return { ok: false, reason: 'closed_today', message: 'Closed today', status: 403 };
    }
    return {
      ok: false,
      reason: 'always_closed',
      message: 'This business is not taking visits right now.',
      status: 403,
    };
  }

  return { ok: true };
}

export class VisitGuardError extends Error {
  constructor(
    message: string,
    public readonly reason: VisitGuardReason,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'VisitGuardError';
  }
}

/** Throws `VisitGuardError` when a visitor may not take a ticket now. */
export async function assertVisitAllowed(input: VisitGuardInput): Promise<void> {
  const result = await checkVisitAllowed(input);
  if (!result.ok) {
    throw new VisitGuardError(
      result.message ?? 'Visits are not allowed right now',
      result.reason ?? 'always_closed',
      result.status ?? 403,
    );
  }
}
