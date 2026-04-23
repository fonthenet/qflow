/**
 * Tests for /api/compliance/delete
 *
 * Run: cd apps/web && npx vitest run src/app/api/compliance/__tests__/delete.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockGetUser,
  mockSignOut,
  mockAdminFrom,
  mockFloodCheck,
  mockExtractIp,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn().mockResolvedValue({}),
  mockAdminFrom: vi.fn(),
  mockFloodCheck: vi.fn(),
  mockExtractIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

vi.mock('@/lib/webhook-rate-limit', () => ({
  extractWebhookIp: mockExtractIp,
  webhookCheckRateLimit: mockFloodCheck,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body?: object) {
  return new Request('http://localhost/api/compliance/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function chainMock(maybeSingleData: unknown = null) {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'is', 'update'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: maybeSingleData, error: null });
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/compliance/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFloodCheck.mockReturnValue({ allowed: true, remaining: 9, retryAfterSeconds: 60 });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('../delete/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 429 when IP rate limit exceeded', async () => {
    mockFloodCheck.mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 45 });
    const { POST } = await import('../delete/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
  });

  it('returns 403 when no staff record exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockAdminFrom.mockReturnValue(chainMock(null)); // no staff row
    const { POST } = await import('../delete/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('non-admin cannot delete customer records', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockAdminFrom.mockReturnValue(
      chainMock({ organization_id: 'org-x', role: 'receptionist', id: 's2' })
    );
    const { POST } = await import('../delete/route');
    const res = await POST(makeRequest({ scope: 'customer', customer_id: 'cust-1' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/only org admins/i);
  });

  it('cross-tenant guard: rejects customer from foreign org (customer lookup returns null)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-org-a' } }, error: null });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff') {
        return chainMock({ organization_id: 'org-a', role: 'admin', id: 's1' });
      }
      // customers lookup returns null (customer not in org-a)
      return chainMock(null);
    });

    const { POST } = await import('../delete/route');
    const res = await POST(
      makeRequest({ scope: 'customer', customer_id: 'cust-from-org-b' })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found in your organization/i);
  });

  it('happy path self-delete: returns 200 with 14-day grace period', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const updateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockAdminFrom.mockImplementation((table: string) => {
      const c = chainMock({ organization_id: 'org-x', role: 'staff', id: 's3' });
      c['update'] = updateFn;
      return c;
    });

    const { POST } = await import('../delete/route');
    const res = await POST(makeRequest({ scope: 'self' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.grace_period_ends).toBeDefined();

    const graceEnd = new Date(body.grace_period_ends).getTime();
    const expected = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(graceEnd - expected)).toBeLessThan(5000);
  });
});
