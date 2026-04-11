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

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-qr-token-1234'),
}));

vi.mock('@/lib/queue-position', () => ({
  getQueuePosition: vi.fn().mockResolvedValue({ position: 3, estimated_wait_minutes: 12 }),
}));

// ── Import route AFTER mocks ────────────────────────────────────────

import { POST } from '../route';

// ── Helpers ─────────────────────────────────────────────────────────

const VALID_BODY = {
  officeId: TEST_IDS.officeId,
  departmentId: TEST_IDS.departmentId,
  serviceId: TEST_IDS.serviceId,
};

const OFFICE_SETTINGS_ROW = {
  settings: {},
  organization: { settings: {} },
};

const TICKET_ROW = {
  id: TEST_IDS.ticketId,
  qr_token: 'mock-qr-token-1234',
  ticket_number: 'A-001',
  status: 'waiting',
  estimated_wait_minutes: 10,
};

function setupSuccessfulFlow() {
  // Track call count to distinguish appointments vs offices vs tickets etc.
  let fromCallIndex = 0;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'offices') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: OFFICE_SETTINGS_ROW, error: null }),
          }),
        }),
      };
    }
    if (table === 'tickets') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: TICKET_ROW, error: null }),
          }),
        }),
      };
    }
    if (table === 'ticket_events') {
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    return { select: vi.fn().mockReturnThis() };
  });

  mockSupabase.rpc.mockImplementation((fnName: string) => {
    if (fnName === 'generate_daily_ticket_number') {
      return Promise.resolve({
        data: [{ seq: 1, ticket_num: 'A-001' }],
        error: null,
      });
    }
    if (fnName === 'estimate_wait_time') {
      return Promise.resolve({ data: 10, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('POST /api/kiosk-ticket', () => {
  it('returns 400 when body is not valid JSON', async () => {
    const req = createMockRequest('POST');
    (req as any).json = vi.fn().mockRejectedValue(new Error('Unexpected token'));

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('returns 400 when required fields are missing', async () => {
    const req = createMockRequest('POST', { officeId: TEST_IDS.officeId });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('required');
  });

  it('returns 400 when departmentId is missing', async () => {
    const req = createMockRequest('POST', {
      officeId: TEST_IDS.officeId,
      serviceId: TEST_IDS.serviceId,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 when kiosk is disabled for the organization', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  settings: {},
                  organization: { settings: { kiosk_enabled: false } },
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

  it('returns 403 when check-in mode is manual', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  settings: {},
                  organization: { settings: { default_check_in_mode: 'manual' } },
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
    expect(json.error).toContain('front desk');
  });

  it('returns 500 when RPC generate_daily_ticket_number fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_SETTINGS_ROW, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RPC failed' },
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('RPC failed');
  });

  it('returns 500 when RPC returns empty data', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_SETTINGS_ROW, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to generate ticket number');
  });

  it('creates a ticket successfully and returns ticket data with queue position', async () => {
    setupSuccessfulFlow();

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket).toBeDefined();
    expect(json.ticket.id).toBe(TEST_IDS.ticketId);
    expect(json.ticket.ticket_number).toBe('A-001');
    expect(json.ticket.qr_token).toBe('mock-qr-token-1234');
    expect(json.ticket.status).toBe('waiting');
    expect(json.ticket.position).toBe(3);
    expect(json.ticket.estimated_wait_minutes).toBe(12);
  });

  it('returns 500 when ticket insert fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_SETTINGS_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'tickets') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Insert failed' },
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    mockSupabase.rpc.mockImplementation((fnName: string) => {
      if (fnName === 'generate_daily_ticket_number') {
        return Promise.resolve({
          data: [{ seq: 1, ticket_num: 'A-001' }],
          error: null,
        });
      }
      if (fnName === 'estimate_wait_time') {
        return Promise.resolve({ data: 10, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Insert failed');
  });

  it('creates ticket with pending_approval status when approval is required', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  settings: { require_ticket_approval: true },
                  organization: { settings: {} },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'tickets') {
        return {
          insert: vi.fn().mockImplementation((payload: any) => ({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { ...TICKET_ROW, status: payload.status ?? 'pending_approval' },
                error: null,
              }),
            }),
          })),
        };
      }
      if (table === 'ticket_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    mockSupabase.rpc.mockImplementation((fnName: string) => {
      if (fnName === 'generate_daily_ticket_number') {
        return Promise.resolve({
          data: [{ seq: 1, ticket_num: 'A-001' }],
          error: null,
        });
      }
      if (fnName === 'estimate_wait_time') {
        return Promise.resolve({ data: 5, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const req = createMockRequest('POST', VALID_BODY);
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ticket).toBeDefined();
  });
});
