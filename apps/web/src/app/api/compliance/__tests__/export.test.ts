/**
 * Tests for /api/compliance/export
 *
 * Run: cd apps/web && npx vitest run src/app/api/compliance/__tests__/export.test.ts
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
function makeRequest() {
  return new Request('http://localhost/api/compliance/export', { method: 'GET' });
}

/** Returns a chainable mock that resolves to { data: [], error: null } by default */
function chainMock(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'in', 'is', 'limit', 'upsert'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null });
  Object.assign(chain, overrides);
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/compliance/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFloodCheck.mockReturnValue({ allowed: true, remaining: 99, retryAfterSeconds: 60 });
  });

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('../export/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 429 when IP flood limit exceeded', async () => {
    mockFloodCheck.mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const { GET } = await import('../export/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 403 when authenticated user has no staff record', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } }, error: null });
    // user_data_exports: no prior export; staff: no record
    mockAdminFrom.mockReturnValue(chainMock());
    const { GET } = await import('../export/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns 429 when user already exported within 30 days', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } }, error: null });

    const recentExportAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    mockAdminFrom.mockImplementation((table: string) => {
      const c = chainMock();
      if (table === 'user_data_exports') {
        (c as any).maybeSingle = vi.fn().mockResolvedValue({
          data: { last_export_at: recentExportAt, export_count: 1 },
          error: null,
        });
      }
      return c;
    });

    const { GET } = await import('../export/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.next_allowed_at).toBeDefined();
  });

  it('cross-tenant: org filter is always derived from authenticated staff row, not query params', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-org-b' } }, error: null });

    const orgFilters: string[] = [];

    mockAdminFrom.mockImplementation((table: string) => {
      const c = chainMock();
      const origEq = vi.fn((col: string, val: string) => {
        if (col === 'organization_id') orgFilters.push(`${table}:${val}`);
        return c;
      });
      c['eq'] = origEq;

      if (table === 'staff') {
        (c as any).maybeSingle = vi.fn().mockResolvedValue({
          data: { organization_id: 'org-b', role: 'admin', id: 's1' },
          error: null,
        });
      }
      if (table === 'offices') {
        // Return no offices so the scoped ticket/appointment fetches are skipped
        (c as any).maybeSingle = vi.fn().mockResolvedValue({ data: [], error: null });
        c['select'] = vi.fn().mockResolvedValue({ data: [], error: null });
      }
      return c;
    });

    const { GET } = await import('../export/route');
    await GET(makeRequest()).catch(() => {});

    // Every filter referencing organization_id must be for org-b
    const leaks = orgFilters.filter((f) => !f.endsWith(':org-b'));
    expect(leaks).toHaveLength(0);
  });
});
