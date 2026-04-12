import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ───────────────────────────────────────────────────
// getAvailableSlots calls .from() on many tables with complex chaining.
// We build a per-table, per-call mock so each query resolves independently.

let queryResults: Record<string, { data: any; error?: any; count?: number }[]>;

function chainable(result: { data: any; error?: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
    'in', 'not', 'is', 'or', 'order', 'limit', 'filter',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // Make the chain itself thenable so `await supabase.from(...).select(...)...` works
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function createMockSupabase() {
  // Each table has a queue of results; successive .from('table') calls
  // shift from the front. This handles the slot-generator querying
  // 'appointments' twice (service-scoped + all-services for daily limit).
  let callIndexes: Record<string, number> = {};

  return {
    resetCallIndexes() { callIndexes = {}; },
    from: vi.fn((table: string) => {
      const idx = callIndexes[table] ?? 0;
      callIndexes[table] = idx + 1;
      const results = queryResults[table] ?? [];
      const result = results[idx] ?? results[results.length - 1] ?? { data: null, error: null };
      const chain = chainable(result);
      return {
        select: vi.fn().mockReturnValue(chain),
        insert: vi.fn().mockReturnValue(chain),
        update: vi.fn().mockReturnValue(chain),
        delete: vi.fn().mockReturnValue(chain),
      };
    }),
  };
}

const mockSupabase = createMockSupabase();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

import { generateTimeSlots, getAvailableSlots } from '../slot-generator';

// ── Helpers ─────────────────────────────────────────────────────────

const OFFICE_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-000000000003';

/** Provide a future date string guaranteed to be within booking horizon. */
function futureDateStr(daysAhead = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

/** Day-of-week name for a date string (matches slot-generator's getDayOfWeek). */
function dayOfWeek(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

function defaultOffice(overrides: Record<string, any> = {}, forDate?: string) {
  const date = forDate ?? futureDateStr();
  const dow = dayOfWeek(date);
  return {
    id: OFFICE_ID,
    timezone: 'UTC',
    organization_id: 'org-1',
    settings: {},
    operating_hours: { [dow]: { open: '08:00', close: '12:00' } },
    ...overrides,
  };
}

function defaultOrg(settingsOverrides: Record<string, any> = {}) {
  return {
    timezone: 'UTC',
    settings: {
      booking_mode: 'simple',
      booking_horizon_days: 14,
      slot_duration_minutes: 30,
      slots_per_interval: 2,
      daily_ticket_limit: 0,
      allow_cancellation: false,
      min_booking_lead_hours: 0,
      ...settingsOverrides,
    },
  };
}

/**
 * Set up the standard query results for a basic getAvailableSlots call.
 * Returns the date used so callers can reference it.
 */
function setupStandard(opts: {
  officeOverrides?: Record<string, any>;
  orgSettingsOverrides?: Record<string, any>;
  holidays?: any[];
  blockedSlots?: any[];
  appointments?: any[];
  allDayAppointments?: any[];
} = {}): string {
  const date = futureDateStr(3);
  const office = defaultOffice(opts.officeOverrides ?? {}, date);
  const org = defaultOrg(opts.orgSettingsOverrides);

  queryResults = {
    offices: [{ data: office, error: null }],
    organizations: [{ data: org, error: null }],
    office_holidays: [{ data: opts.holidays ?? [], error: null }],
    blocked_slots: [{ data: opts.blockedSlots ?? [], error: null }],
    // First call: service-scoped appointments. Second call: all-services for daily limit.
    appointments: [
      { data: opts.appointments ?? [], error: null },
      { data: opts.allDayAppointments ?? opts.appointments ?? [], error: null, count: (opts.allDayAppointments ?? opts.appointments ?? []).length },
    ],
  };

  return date;
}

// ── Pure function tests ─────────────────────────────────────────────

describe('generateTimeSlots', () => {
  it('generates correct 30-minute slots for a morning schedule', () => {
    const slots = generateTimeSlots('08:00', '12:00', 30);
    expect(slots).toEqual([
      '08:00', '08:30', '09:00', '09:30',
      '10:00', '10:30', '11:00', '11:30',
    ]);
  });

  it('generates correct 60-minute slots', () => {
    const slots = generateTimeSlots('09:00', '12:00', 60);
    expect(slots).toEqual(['09:00', '10:00', '11:00']);
  });

  it('generates correct 15-minute slots', () => {
    const slots = generateTimeSlots('10:00', '11:00', 15);
    expect(slots).toEqual(['10:00', '10:15', '10:30', '10:45']);
  });

  it('does not include the closing time itself', () => {
    const slots = generateTimeSlots('08:00', '09:00', 30);
    expect(slots).toEqual(['08:00', '08:30']);
    expect(slots).not.toContain('09:00');
  });

  it('returns empty array when open equals close', () => {
    const slots = generateTimeSlots('08:00', '08:00', 30);
    expect(slots).toEqual([]);
  });

  it('handles non-aligned durations', () => {
    const slots = generateTimeSlots('08:00', '09:00', 20);
    expect(slots).toEqual(['08:00', '08:20', '08:40']);
  });

  it('handles crossing hour boundaries', () => {
    const slots = generateTimeSlots('08:45', '10:00', 30);
    expect(slots).toEqual(['08:45', '09:15', '09:45']);
  });

  it('generates a full day of slots', () => {
    const slots = generateTimeSlots('08:00', '17:00', 30);
    expect(slots.length).toBe(18);
    expect(slots[0]).toBe('08:00');
    expect(slots[slots.length - 1]).toBe('16:30');
  });
});

// ── Async getAvailableSlots tests ───────────────────────────────────

describe('getAvailableSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResults = {};
    mockSupabase.resetCallIndexes();
  });

  it('returns slots with correct remaining capacity for a valid office/service/date', async () => {
    const date = setupStandard();
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.officeId).toBe(OFFICE_ID);
    expect(result.date).toBe(date);
    // 08:00-12:00 with 30 min slots = 8 slots, each with remaining=2 (slots_per_interval)
    expect(result.slots.length).toBe(8);
    expect(result.slots[0]).toEqual({ time: '08:00', remaining: 2, total: 2 });
    expect(result.meta.booking_mode).toBe('simple');
    expect(result.meta.office_closed).toBe(false);
    expect(result.meta.is_holiday).toBe(false);
  });

  it('reduces remaining count based on existing appointments', async () => {
    const date = futureDateStr(3);
    // Use explicit UTC format — the source uses timeInTz(new Date(...), orgTimezone)
    const scheduledAt = `${date}T08:00:00Z`;
    const appointments = [{ scheduled_at: scheduledAt }];

    setupStandard({ appointments });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    // The 08:00 slot should have remaining=1 (2 total - 1 booked)
    const slot0800 = result.slots.find((s) => s.time === '08:00');
    expect(slot0800).toBeDefined();
    expect(slot0800!.remaining).toBe(1);
    expect(slot0800!.total).toBe(2);
  });

  it('removes fully booked slots from the result', async () => {
    const date = futureDateStr(3);
    const scheduledAt = `${date}T08:00:00Z`;
    // Two bookings fill up the slot (slots_per_interval=2)
    const appointments = [
      { scheduled_at: scheduledAt },
      { scheduled_at: scheduledAt },
    ];

    setupStandard({ appointments });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    const slot0800 = result.slots.find((s) => s.time === '08:00');
    expect(slot0800).toBeUndefined();
    // Other slots should still be present
    expect(result.slots.length).toBe(7);
  });

  it('returns empty result when booking mode is disabled', async () => {
    const date = setupStandard({ orgSettingsOverrides: { booking_mode: 'disabled' } });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
    expect(result.meta.office_closed).toBe(true);
  });

  it('returns empty result with is_holiday=true for a full-day holiday', async () => {
    const date = setupStandard({
      holidays: [{ id: 'h1', is_full_day: true }],
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
    expect(result.meta.is_holiday).toBe(true);
  });

  it('returns slots with is_holiday=true for a partial holiday', async () => {
    const date = setupStandard({
      holidays: [{ id: 'h1', is_full_day: false }],
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.meta.is_holiday).toBe(true);
  });

  it('returns empty result when office is closed on that day', async () => {
    const date = futureDateStr(3);
    const dow = dayOfWeek(date);
    // Mark the day as closed (null operating hours)
    setupStandard({
      officeOverrides: { operating_hours: { [dow]: null } },
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
    expect(result.meta.office_closed).toBe(true);
  });

  it('returns empty result when office day has 00:00-00:00 hours (closed)', async () => {
    const date = futureDateStr(3);
    const dow = dayOfWeek(date);
    setupStandard({
      officeOverrides: { operating_hours: { [dow]: { open: '00:00', close: '00:00' } } },
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
    expect(result.meta.office_closed).toBe(true);
  });

  it('returns empty slots when daily ticket limit is reached', async () => {
    const date = futureDateStr(3);
    // Daily limit = 2, and 2 appointments already exist across all services
    const scheduledAt1 = `${date}T08:00:00.000Z`;
    const scheduledAt2 = `${date}T09:00:00.000Z`;
    const appointments = [
      { scheduled_at: scheduledAt1 },
    ];
    const allDayAppointments = [
      { id: 'a1' },
      { id: 'a2' },
    ];

    setupStandard({
      orgSettingsOverrides: { daily_ticket_limit: 2 },
      appointments,
      allDayAppointments,
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
    expect(result.meta.daily_limit_reached).toBe(true);
    expect(result.meta.daily_booking_count).toBe(2);
  });

  it('returns empty result when office is not found', async () => {
    queryResults = {
      offices: [{ data: null, error: { message: 'not found' } }],
    };
    const date = futureDateStr(3);
    const result = await getAvailableSlots({ officeId: 'nonexistent', serviceId: SERVICE_ID, date });

    expect(result.slots).toEqual([]);
  });

  it('returns empty result when date is outside booking horizon', async () => {
    // Default horizon is 90 days, use date 120 days ahead
    const d = new Date();
    d.setDate(d.getDate() + 120);
    const farDate = d.toISOString().split('T')[0];

    setupStandard();
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date: farDate });

    expect(result.slots).toEqual([]);
  });

  it('uses default hours when no operating_hours configured for the day', async () => {
    const date = futureDateStr(3);
    // operating_hours object exists but doesn't have the target day
    setupStandard({
      officeOverrides: { operating_hours: {} },
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    // Default hours are 08:00-17:00 with 30 min slots = 18 slots
    expect(result.slots.length).toBe(18);
    expect(result.slots[0].time).toBe('08:00');
    expect(result.slots[result.slots.length - 1].time).toBe('16:30');
  });

  it('populates meta fields correctly', async () => {
    const date = setupStandard({
      orgSettingsOverrides: {
        booking_mode: 'advanced',
        booking_horizon_days: 21,
        slot_duration_minutes: 15,
        slots_per_interval: 5,
        daily_ticket_limit: 100,
        allow_cancellation: true,
      },
    });
    const result = await getAvailableSlots({ officeId: OFFICE_ID, serviceId: SERVICE_ID, date });

    expect(result.meta.booking_mode).toBe('advanced');
    expect(result.meta.booking_horizon_days).toBe(21);
    expect(result.meta.slot_duration_minutes).toBe(15);
    expect(result.meta.slots_per_interval).toBe(5);
    expect(result.meta.daily_ticket_limit).toBe(100);
    expect(result.meta.allow_cancellation).toBe(true);
  });
});
