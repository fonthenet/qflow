import { vi } from 'vitest';

// ── NextRequest mock ────────────────────────────────────────────────

export function createMockRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request & { nextUrl: URL } {
  const headersMap = new Map(Object.entries(headers ?? {}));
  return {
    method,
    json: body !== undefined ? vi.fn().mockResolvedValue(body) : vi.fn().mockRejectedValue(new Error('No body')),
    headers: {
      get: (key: string) => headersMap.get(key.toLowerCase()) ?? headersMap.get(key) ?? null,
      has: (key: string) => headersMap.has(key.toLowerCase()) || headersMap.has(key),
      entries: () => headersMap.entries(),
      forEach: (cb: (v: string, k: string) => void) => headersMap.forEach(cb),
    },
    nextUrl: new URL('http://localhost:3000/api/test'),
  } as any;
}

// ── Chainable Supabase mock builder ─────────────────────────────────

type MockResult = { data: any; error: any };

/**
 * Creates a chainable mock that supports the Supabase query-builder pattern:
 *   supabase.from('table').select('...').eq('field', val).single()
 *
 * Configure per-table results with `mockTable('table', { data, error })`.
 * Configure RPC results with `mockRpc('fn_name', { data, error })`.
 */
export function createMockSupabase() {
  const tableResults = new Map<string, MockResult>();
  const rpcResults = new Map<string, MockResult>();
  const insertResults = new Map<string, MockResult>();
  const updateResults = new Map<string, MockResult>();

  function chainable(result: MockResult) {
    const chain: any = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.or = vi.fn().mockReturnValue(chain);
    chain.neq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (onfulfilled: any, onrejected?: any) =>
      Promise.resolve(result).then(onfulfilled, onrejected);
    return chain;
  }

  const client = {
    from: vi.fn((table: string) => {
      const selectResult = tableResults.get(table) ?? { data: null, error: null };
      const insResult = insertResults.get(table) ?? { data: null, error: null };
      const updResult = updateResults.get(table) ?? { data: null, error: null };

      const selectChain = chainable(selectResult);
      const insertChain = chainable(insResult);
      const updateChain = chainable(updResult);

      return {
        select: vi.fn().mockReturnValue(selectChain),
        insert: vi.fn().mockReturnValue(insertChain),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(chainable({ data: null, error: null })),
      };
    }),
    rpc: vi.fn((fnName: string) => {
      const result = rpcResults.get(fnName) ?? { data: null, error: null };
      return Promise.resolve(result);
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }),
    },
    // Test configuration helpers (not part of real Supabase API)
    _mockTable: (table: string, result: MockResult) => {
      tableResults.set(table, result);
    },
    _mockInsert: (table: string, result: MockResult) => {
      insertResults.set(table, result);
    },
    _mockUpdate: (table: string, result: MockResult) => {
      updateResults.set(table, result);
    },
    _mockRpc: (name: string, result: MockResult) => {
      rpcResults.set(name, result);
    },
  };

  return client;
}

// ── Constants ───────────────────────────────────────────────────────

export const TEST_IDS = {
  officeId: 'office-test-001',
  departmentId: 'dept-test-001',
  serviceId: 'svc-test-001',
  organizationId: 'org-test-001',
  appointmentId: 'appt-test-001',
  ticketId: 'ticket-test-001',
  staffId: 'staff-test-001',
} as const;

export const SERVICE_ROLE_KEY = 'test-service-role-key-xxx';
export const WEBHOOK_SECRET = 'test-webhook-secret-yyy';
