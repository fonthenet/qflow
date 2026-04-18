import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  TEST_IDS,
  SERVICE_ROLE_KEY,
} from '@/__test-utils__/route-test-utils';

// ── Hoisted mocks ───────────────────────────────────────────────────

const mockSupabase: any = {
  from: vi.fn(),
  rpc: vi.fn(),
};

const { getAvailableSlotsMock, upsertCustomerMock, sendWhatsAppMessageMock } = vi.hoisted(() => ({
  getAvailableSlotsMock: vi.fn(),
  upsertCustomerMock: vi.fn().mockResolvedValue(undefined),
  sendWhatsAppMessageMock: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-cal-token-5678'),
}));

vi.mock('@/lib/slot-generator', () => ({
  getAvailableSlots: getAvailableSlotsMock,
}));

vi.mock('@/lib/upsert-customer', () => ({
  upsertCustomerFromBooking: upsertCustomerMock,
}));

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

vi.mock('@/lib/messaging-commands', () => ({
  t: vi.fn(() => 'Mocked booking message'),
}));

// ── Import route AFTER mocks ────────────────────────────────────────

import { POST } from '../route';

// ── Helpers ─────────────────────────────────────────────────────────

// Use a scheduledAt without 'Z' so new Date() parses it as local time.
// The route extracts hours/minutes via getHours()/getMinutes() (local TZ).
const VALID_BODY = {
  officeId: TEST_IDS.officeId,
  departmentId: TEST_IDS.departmentId,
  serviceId: TEST_IDS.serviceId,
  customerName: 'Test Customer',
  customerPhone: '+213555000000',
  scheduledAt: '2026-04-15T10:00:00',
};

const APPOINTMENT_ROW = {
  id: TEST_IDS.appointmentId,
  office_id: TEST_IDS.officeId,
  department_id: TEST_IDS.departmentId,
  service_id: TEST_IDS.serviceId,
  customer_name: 'Test Customer',
  customer_phone: '+213555000000',
  customer_email: null,
  scheduled_at: '2026-04-15T10:00:00',
  status: 'pending',
  notes: null,
  wilaya: null,
  calendar_token: 'mock-cal-token-5678',
  staff_id: null,
};

const AVAILABLE_SLOTS_RESULT = {
  officeId: TEST_IDS.officeId,
  date: '2026-04-15',
  slots: [
    { time: '10:00', remaining: 2, total: 3, available: true },
    { time: '11:00', remaining: 1, total: 3, available: true },
  ],
  meta: {
    booking_mode: 'open',
    office_closed: false,
    is_holiday: false,
    daily_limit_reached: false,
  },
};

const OFFICE_ORG_ROW = {
  settings: { require_appointment_approval: true },
  organization: { settings: {} },
};

function setupSuccessfulFlow() {
  getAvailableSlotsMock.mockResolvedValue(AVAILABLE_SLOTS_RESULT);

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'offices') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: OFFICE_ORG_ROW, error: null }),
          }),
        }),
      };
    }
    if (table === 'appointments') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: APPOINTMENT_ROW, error: null }),
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    };
  });
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('POST /api/book-appointment', () => {
  it('returns 400 when body is not valid JSON', async () => {
    const req = createMockRequest('POST');
    (req as any).json = vi.fn().mockRejectedValue(new Error('Unexpected token'));

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when required fields are missing', async () => {
    const req = createMockRequest('POST', {
      officeId: TEST_IDS.officeId,
      customerName: 'Test',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing required fields');
  });

  it('returns 400 when scheduledAt is missing', async () => {
    const req = createMockRequest('POST', {
      officeId: TEST_IDS.officeId,
      departmentId: TEST_IDS.departmentId,
      serviceId: TEST_IDS.serviceId,
      customerName: 'Test Customer',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 when web booking is disabled', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  organization: { settings: { web_enabled: false } },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('disabled');
  });

  it('returns 403 when booking mode is disabled', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { organization: { settings: {} } },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });
    getAvailableSlotsMock.mockResolvedValue({
      ...AVAILABLE_SLOTS_RESULT,
      meta: { ...AVAILABLE_SLOTS_RESULT.meta, booking_mode: 'disabled' },
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 when office is closed on selected date', async () => {
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { organization: { settings: {} } },
            error: null,
          }),
        }),
      }),
    }));
    getAvailableSlotsMock.mockResolvedValue({
      ...AVAILABLE_SLOTS_RESULT,
      meta: { ...AVAILABLE_SLOTS_RESULT.meta, office_closed: true },
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('closed');
  });

  it('returns 409 when daily limit is reached', async () => {
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { organization: { settings: {} } },
            error: null,
          }),
        }),
      }),
    }));
    getAvailableSlotsMock.mockResolvedValue({
      ...AVAILABLE_SLOTS_RESULT,
      meta: { ...AVAILABLE_SLOTS_RESULT.meta, daily_limit_reached: true },
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('limit');
  });

  it('returns 409 when the requested time slot is not available', async () => {
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { organization: { settings: {} } },
            error: null,
          }),
        }),
      }),
    }));
    getAvailableSlotsMock.mockResolvedValue({
      ...AVAILABLE_SLOTS_RESULT,
      // Only 11:00 is available, but we request 10:00
      slots: [{ time: '11:00', remaining: 1, total: 3, available: true }],
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('not available');
  });

  it('returns 201 with appointment data on successful booking', async () => {
    setupSuccessfulFlow();

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.appointment).toBeDefined();
    expect(json.appointment.id).toBe(TEST_IDS.appointmentId);
    expect(json.appointment.customer_name).toBe('Test Customer');
    expect(json.appointment.status).toBe('pending');
  });

  it('returns 409 with slot_just_taken on unique constraint violation (race)', async () => {
    getAvailableSlotsMock.mockResolvedValue(AVAILABLE_SLOTS_RESULT);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ORG_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'appointments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'uniq_appointments_active_slot' },
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('slot_just_taken');
  });

  it('returns 409 when daily_limit_reached error comes from DB trigger', async () => {
    getAvailableSlotsMock.mockResolvedValue(AVAILABLE_SLOTS_RESULT);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ORG_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'appointments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'P0001', message: 'daily_limit_reached' },
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('daily_limit_reached');
  });

  it('returns 500 on generic database error', async () => {
    getAvailableSlotsMock.mockResolvedValue(AVAILABLE_SLOTS_RESULT);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ORG_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'appointments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '42000', message: 'Some DB error' },
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Some DB error');
  });

  it('sends WhatsApp notification on successful booking when phone is present', async () => {
    setupSuccessfulFlow();

    const req = createMockRequest('POST', VALID_BODY);
    await POST(req as any);
    expect(sendWhatsAppMessageMock).toHaveBeenCalled();
  });
});
