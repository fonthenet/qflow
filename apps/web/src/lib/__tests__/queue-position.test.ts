import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ───────────────────────────────────────────────────

type QueryResult = { data: any; error?: any; count?: number | null };

let queryQueue: QueryResult[];
let queueIndex: number;

function chainable(resultFn: () => QueryResult) {
  const chain: any = {};
  const methods = [
    'select', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
    'in', 'not', 'is', 'or', 'order', 'limit', 'filter',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn(() => Promise.resolve(resultFn()));
  chain.maybeSingle = vi.fn(() => Promise.resolve(resultFn()));
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve(resultFn()).then(resolve, reject);
  return chain;
}

function createMockClient() {
  return {
    from: vi.fn(() => {
      const idx = queueIndex;
      queueIndex++;
      const chain = chainable(() => queryQueue[idx] ?? { data: null, error: null });
      return {
        select: vi.fn().mockReturnValue(chain),
      };
    }),
  };
}

const mockClient = createMockClient();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}));

import { getQueuePosition } from '../queue-position';

// ── Helpers ─────────────────────────────────────────────────────────

const TICKET_ID = 'ticket-001';
const OFFICE_ID = 'office-001';

function waitingTicket(overrides: Record<string, any> = {}) {
  return {
    id: TICKET_ID,
    status: 'waiting',
    office_id: OFFICE_ID,
    service_id: 'svc-1',
    priority: 0,
    created_at: '2026-04-10T10:00:00Z',
    parked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue = [];
  queueIndex = 0;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('getQueuePosition', () => {
  it('returns position=null when ticket is not found', async () => {
    queryQueue = [
      { data: null, error: { message: 'not found' } },
    ];

    const result = await getQueuePosition('nonexistent');

    expect(result.position).toBeNull();
    expect(result.total_waiting).toBe(0);
    expect(result.estimated_wait_minutes).toBeNull();
    expect(result.now_serving).toBeNull();
  });

  it('returns position=0 for a called/serving ticket', async () => {
    queryQueue = [
      // 1. Fetch the ticket
      { data: waitingTicket({ status: 'called' }), error: null },
      // 2. Now-serving lookup
      { data: { ticket_number: 'A-005' }, error: null },
    ];

    const result = await getQueuePosition(TICKET_ID);

    expect(result.position).toBe(0);
    expect(result.estimated_wait_minutes).toBe(0);
    expect(result.now_serving).toBe('A-005');
  });

  it('returns position=null for completed/cancelled tickets', async () => {
    queryQueue = [
      { data: waitingTicket({ status: 'served' }), error: null },
    ];

    const result = await getQueuePosition(TICKET_ID);

    expect(result.position).toBeNull();
    expect(result.total_waiting).toBe(0);
  });

  it('calculates correct position with no tickets ahead', async () => {
    queryQueue = [
      // 1. Fetch ticket
      { data: waitingTicket(), error: null },
      // 2. Higher priority count (via Promise.all)
      { data: null, error: null, count: 0 },
      // 3. Same priority earlier count
      { data: null, error: null, count: 0 },
      // 4. Total waiting
      { data: null, error: null, count: 1 },
      // 5. Now serving
      { data: null, error: null },
      // 6. Recent served (for avg service time)
      { data: [], error: null },
    ];

    const result = await getQueuePosition(TICKET_ID);

    expect(result.position).toBe(1);
    expect(result.total_waiting).toBe(1);
    // Position 1 => wait = (1-1) * avgServiceTime = 0
    expect(result.estimated_wait_minutes).toBe(0);
  });

  it('accounts for higher priority tickets ahead', async () => {
    queryQueue = [
      // 1. Fetch ticket (priority 0)
      { data: waitingTicket({ priority: 0 }), error: null },
      // 2. Higher priority count = 3 tickets with priority > 0
      { data: null, error: null, count: 3 },
      // 3. Same priority earlier = 2 tickets with priority=0 created before
      { data: null, error: null, count: 2 },
      // 4. Total waiting = 10
      { data: null, error: null, count: 10 },
      // 5. Now serving
      { data: { ticket_number: 'B-002' }, error: null },
      // 6. Recent served: 2 tickets averaging 10 min each
      {
        data: [
          { serving_started_at: '2026-04-10T09:00:00Z', completed_at: '2026-04-10T09:10:00Z' },
          { serving_started_at: '2026-04-10T09:10:00Z', completed_at: '2026-04-10T09:20:00Z' },
        ],
        error: null,
      },
    ];

    const result = await getQueuePosition(TICKET_ID);

    // position = 1 + 3 (higher priority) + 2 (same priority earlier) = 6
    expect(result.position).toBe(6);
    expect(result.total_waiting).toBe(10);
    // estimated wait = (6-1) * 10 = 50 minutes
    expect(result.estimated_wait_minutes).toBe(50);
    expect(result.now_serving).toBe('B-002');
  });

  it('uses FIFO ordering for same-priority tickets', async () => {
    queryQueue = [
      // Ticket at priority 5
      { data: waitingTicket({ priority: 5 }), error: null },
      // No higher priority tickets
      { data: null, error: null, count: 0 },
      // 4 same-priority tickets created earlier
      { data: null, error: null, count: 4 },
      // Total waiting
      { data: null, error: null, count: 8 },
      // Now serving
      { data: null, error: null },
      // Recent served: default 5 min per ticket
      { data: [], error: null },
    ];

    const result = await getQueuePosition(TICKET_ID);

    // position = 1 + 0 + 4 = 5
    expect(result.position).toBe(5);
    // estimated wait = (5-1) * 5 (default) = 20
    expect(result.estimated_wait_minutes).toBe(20);
  });

  it('handles empty queue (only this ticket waiting)', async () => {
    queryQueue = [
      { data: waitingTicket(), error: null },
      // 0 higher priority
      { data: null, error: null, count: 0 },
      // 0 same priority earlier
      { data: null, error: null, count: 0 },
      // 1 total waiting (this ticket itself)
      { data: null, error: null, count: 1 },
      // No one serving
      { data: null, error: null },
      // No history
      { data: [], error: null },
    ];

    const result = await getQueuePosition(TICKET_ID);

    expect(result.position).toBe(1);
    expect(result.total_waiting).toBe(1);
    expect(result.estimated_wait_minutes).toBe(0);
    expect(result.now_serving).toBeNull();
  });

  it('computes average service time from recent history', async () => {
    queryQueue = [
      { data: waitingTicket(), error: null },
      // 1 ticket ahead
      { data: null, error: null, count: 1 },
      // 0 same priority earlier
      { data: null, error: null, count: 0 },
      // Total waiting
      { data: null, error: null, count: 5 },
      // Now serving
      { data: { ticket_number: 'C-003' }, error: null },
      // Recent served: 3 tickets - 15min, 5min, 10min -> avg=10min
      {
        data: [
          { serving_started_at: '2026-04-10T09:00:00Z', completed_at: '2026-04-10T09:15:00Z' },
          { serving_started_at: '2026-04-10T09:15:00Z', completed_at: '2026-04-10T09:20:00Z' },
          { serving_started_at: '2026-04-10T09:20:00Z', completed_at: '2026-04-10T09:30:00Z' },
        ],
        error: null,
      },
    ];

    const result = await getQueuePosition(TICKET_ID);

    // position = 1 + 1 + 0 = 2
    expect(result.position).toBe(2);
    // estimated wait = (2-1) * 10 = 10
    expect(result.estimated_wait_minutes).toBe(10);
    expect(result.now_serving).toBe('C-003');
  });
});
