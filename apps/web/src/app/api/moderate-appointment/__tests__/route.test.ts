import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  TEST_IDS,
  SERVICE_ROLE_KEY,
  WEBHOOK_SECRET,
} from '@/__test-utils__/route-test-utils';

// ── Hoisted mocks ───────────────────────────────────────────────────

const mockAnonSupabase: any = {
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    }),
  },
};

const mockAdminSupabase: any = {
  from: vi.fn(),
};

const { transitionAppointmentMock, checkInAppointmentMock } = vi.hoisted(() => ({
  transitionAppointmentMock: vi.fn(),
  checkInAppointmentMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAnonSupabase),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}));

vi.mock('@/lib/lifecycle', () => ({
  transitionAppointment: transitionAppointmentMock,
  onTicketTerminal: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  notifyCustomer: vi.fn().mockResolvedValue({ notified: false, channel: null }),
}));

vi.mock('@/lib/actions/appointment-actions', () => ({
  checkInAppointment: checkInAppointmentMock,
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
    (req as any).json = vi.fn().mockRejectedValue(new Error('Unexpected token'));

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
  });

  it('approve: returns 200 and sets status to confirmed for a pending appointment', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: true,
      status: 'confirmed',
      notified: true,
      channel: 'whatsapp',
      notifyError: null,
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('confirmed');
    expect(transitionAppointmentMock).toHaveBeenCalledWith(
      TEST_IDS.appointmentId,
      'confirmed',
      { reason: undefined },
    );
  });

  it('decline: returns 200 and sets status to cancelled with reason for a pending appointment', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: true,
      status: 'cancelled',
      notified: true,
      channel: 'whatsapp',
      notifyError: null,
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
    expect(transitionAppointmentMock).toHaveBeenCalledWith(
      TEST_IDS.appointmentId,
      'cancelled',
      { reason: 'Fully booked' },
    );
  });

  it('approve: returns 409 when appointment is not in valid state', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: false,
      status: 'confirmed',
      notified: false,
      channel: null,
      notifyError: 'Already in terminal state: confirmed',
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('terminal state');
  });

  it('cancel: returns 200 and sets status to cancelled for a confirmed appointment', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: true,
      status: 'cancelled',
      notified: false,
      channel: null,
      notifyError: null,
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'cancel' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('cancelled');
  });

  it('no_show: returns 200 and sets status to no_show for a confirmed appointment', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: true,
      status: 'no_show',
      notified: true,
      channel: 'whatsapp',
      notifyError: null,
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'no_show' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('no_show');
  });

  it('cancel: returns 409 for an already-cancelled appointment', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: false,
      status: 'cancelled',
      notified: false,
      channel: null,
      notifyError: 'Already in terminal state: cancelled',
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'cancel' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('terminal state');
  });

  it('check_in: returns 200 with ticket data on success', async () => {
    checkInAppointmentMock.mockResolvedValue({
      data: { ticket: { id: TEST_IDS.ticketId, ticket_number: 'A-001' } },
      error: null,
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'check_in' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('checked_in');
    expect(json.ticket.id).toBe(TEST_IDS.ticketId);
  });

  it('check_in: returns 409 when check-in fails', async () => {
    checkInAppointmentMock.mockResolvedValue({
      data: null,
      error: 'Already checked in',
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'check_in' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Already checked in');
  });

  it('complete: returns 200 and marks appointment completed', async () => {
    const updateChain: any = {};
    updateChain.eq = vi.fn().mockReturnValue(updateChain);
    updateChain.in = vi.fn().mockResolvedValue({ data: [], error: null });
    updateChain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    updateChain.then = (fn: any) => Promise.resolve({ error: null }).then(fn);

    mockAdminSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue(updateChain),
      update: vi.fn().mockReturnValue(updateChain),
    }));

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'complete' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('completed');
  });

  it('returns 409 when transition not found (appointment does not exist)', async () => {
    transitionAppointmentMock.mockResolvedValue({
      ok: false,
      status: 'unknown',
      notified: false,
      channel: null,
      notifyError: 'Not found',
    });

    const req = authedRequest({ appointmentId: TEST_IDS.appointmentId, action: 'approve' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Not found');
  });
});
