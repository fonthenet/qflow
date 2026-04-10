import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockRequest,
  TEST_IDS,
  SERVICE_ROLE_KEY,
} from '@/__test-utils__/route-test-utils';

// ── Hoisted mocks ───────────────────────────────────────────────────

const mockSupabase: any = {
  from: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// ── Import route AFTER mocks ────────────────────────────────────────

import { POST } from '../route';

// ── Helpers ─────────────────────────────────────────────────────────

const VALID_TOKEN = 'qr-token-abc123';

const WAITING_TICKET = {
  id: TEST_IDS.ticketId,
  status: 'waiting',
  customer_data: { name: 'Original Name' },
};

const CALLED_TICKET = {
  id: TEST_IDS.ticketId,
  status: 'called',
  customer_data: {},
};

const COMPLETED_TICKET = {
  id: TEST_IDS.ticketId,
  status: 'completed',
  customer_data: {},
};

function setupTicketLookup(ticket: any) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'tickets') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: ticket, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    }
    return { select: vi.fn().mockReturnThis() };
  });
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('POST /api/ticket-update', () => {
  it('returns 400 when token is missing', async () => {
    const req = createMockRequest('POST', { name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('token is required');
  });

  it('returns 400 when token is not a string', async () => {
    const req = createMockRequest('POST', { token: 123, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when ticket is not found', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tickets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', { token: 'nonexistent-token' });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Ticket not found');
  });

  it('returns 409 when ticket is in completed state (not editable)', async () => {
    setupTicketLookup(COMPLETED_TICKET);

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('no longer editable');
  });

  it('returns 409 when ticket is in cancelled state', async () => {
    setupTicketLookup({ ...WAITING_TICKET, status: 'cancelled' });

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
  });

  it('returns 409 when ticket is in no_show state', async () => {
    setupTicketLookup({ ...WAITING_TICKET, status: 'no_show' });

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(409);
  });

  it('successfully updates customer name on a waiting ticket', async () => {
    setupTicketLookup(WAITING_TICKET);

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'Updated Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('successfully updates customer data on a called ticket', async () => {
    setupTicketLookup(CALLED_TICKET);

    const req = createMockRequest('POST', {
      token: VALID_TOKEN,
      name: 'John',
      phone: '+213555111222',
      reason: 'Consultation',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('returns 500 when the update query fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tickets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: WAITING_TICKET, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Update failed');
  });

  it('returns 500 when Supabase is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Re-mock createClient to return null when no config
    const { createClient } = await import('@supabase/supabase-js');
    (createClient as any).mockImplementation(() => null);

    const req = createMockRequest('POST', { token: VALID_TOKEN, name: 'New Name' });
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Supabase not configured');
  });
});
