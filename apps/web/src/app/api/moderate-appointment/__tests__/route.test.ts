import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  createMockSupabase,
  TEST_IDS,
  SERVICE_ROLE_KEY,
  WEBHOOK_SECRET,
} from '@/__test-utils__/route-test-utils';

// ── Hoisted mocks ───────────────────────────────────────────────────

const mockSupabase: any = createMockSupabase();
const mockAnonSupabase: any = createMockSupabase();

const { sendWhatsAppMessageMock, sendMessengerMessageMock } = vi.hoisted(() => ({
  sendWhatsAppMessageMock: vi.fn().mockResolvedValue({ ok: true }),
  sendMessengerMessageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url: string, key: string) => {
    // The route creates two clients: service-role and anon (for auth check)
    if (key === SERVICE_ROLE_KEY) return mockSupabase;
    return mockAnonSupabase;
  }),
}));

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

vi.mock('@/lib/messenger', () => ({
  sendMessengerMessage: sendMessengerMessageMock,
}));

vi.mock('@/lib/messaging-commands', () => ({
  t: vi.fn((_key: string, _locale: string, _vars: any) => 'Mocked message'),
}));

vi.mock('@/lib/crypto-utils', () => ({
  safeCompare: vi.fn((a: string, b: string) => a === b),
}));

// ── Import route AFTER mocks ────────────────────────────────────────

import { POST } from '../route';

// ── Helpers ─────────────────────────────────────────────────────────

function authedRequest(body: unknown) {
  return createMockRequest('POST', body, {
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  });
}

const PENDING_APPT = {
  id: TEST_IDS.appointmentId,
  office_id: TEST_IDS.officeId,
  status: 'pending',
  customer_phone: '+213555000000',
  customer_name: 'Test Customer',
  scheduled_at: '2026-04-15T10:00:00Z',
  service_id: TEST_IDS.serviceId,
  department_id: TEST_IDS.departmentId,
  locale: 'fr',
};

const CONFIRMED_APPT = { ...PENDING_APPT, status: 'confirmed' };

const OFFICE_ROW = {
  id: TEST_IDS.officeId,
  organization_id: TEST_IDS.organizationId,
  timezone: 'Africa/Algiers',
  organization: { id: TEST_IDS.organizationId, name: 'Test Clinic' },
};

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.INTERNAL_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('POST /api/moderate-appointment', () => {
  it('returns 401 when no authorization header is provided', async () => {
    const req = createMockRequest('POST', {
      appointmentId: TEST_IDS.appointmentId,
      action: 'approve',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when Bearer token is invalid', async () => {
    const req = createMockRequest(
      'POST',
      { appointmentId: TEST_IDS.appointmentId, action: 'approve' },
      { authorization: 'Bearer bad-token' },
    );
    // Mock the anon supabase auth.getUser to reject
    mockAnonSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing appointmentId', async () => {
    const req = authedRequest({ action: 'approve' });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('appointmentId');
  });

  it('returns 400 when action is invalid', async () => {
    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'something' });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = createMockRequest('POST', undefined, {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    });
    // Override json to throw
    (req as any).json = vi.fn().mockRejectedValue(new Error('Unexpected token'));

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('returns 404 when appointment does not exist', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        const chain: any = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } });
        return chain;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const req = authedRequest({ appointmentId: 'nonexistent', action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });

  it('approve: returns 200 and sets status to confirmed for a pending appointment', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...PENDING_APPT }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('confirmed');
  });

  it('decline: returns 200 and sets status to cancelled with reason for a pending appointment', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...PENDING_APPT }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({
      appointmentId: TEST_IDS.appointmentId,
      action: 'decline',
      reason: 'Fully booked',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('cancelled');
  });

  it('approve: returns 409 when appointment is not pending', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...CONFIRMED_APPT }, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('not pending');
  });

  it('cancel: returns 200 and sets status to cancelled for a confirmed appointment', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...CONFIRMED_APPT }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'cancel' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('cancelled');
  });

  it('no_show: returns 200 and sets status to no_show for a confirmed appointment', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...CONFIRMED_APPT }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'offices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: OFFICE_ROW, error: null }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_sessions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'no_show' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('no_show');
  });

  it('cancel: returns 409 for an already-cancelled appointment', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { ...PENDING_APPT, status: 'cancelled' },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'cancel' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('terminal state');
  });
});
