/**
 * Tests for sync-ops.ts — offline-first post-signup operations queue.
 *
 * Covers:
 * - backoffDelayMs: cap, doubling, zero on first attempt
 * - SyncOpsEngine.enqueue: row creation, count, breakdown
 * - reconcileLocalId: rewrites embedded local IDs in pending payloads
 * - Drain behavior: success (create → remote_id set; update/delete → row deleted)
 * - Permanent failure on 4xx (not retried)
 * - Transient failure on 5xx / network error (next_retry_at set)
 * - ID reconciliation on successful create (localId != serverId)
 * - Integration: offline → online transition drains queue
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SyncOpsEngine, backoffDelayMs, reconcileLocalId } from '../sync-ops';

// ── Minimal schema for tests ───────────────────────────────────────
function createDB(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE pending_sync_ops (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      local_id TEXT,
      remote_id TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_retry_at INTEGER
    );
  `);
  return db;
}

function makeEngine(db: Database.Database, url = 'https://supabase.example.com', key = 'test-anon-key') {
  return new SyncOpsEngine(db, url, key);
}

// ── backoffDelayMs ─────────────────────────────────────────────────
describe('backoffDelayMs', () => {
  it('returns 0 for 0 attempts', () => {
    expect(backoffDelayMs(0)).toBe(0);
  });

  it('returns 30s for 1 attempt', () => {
    expect(backoffDelayMs(1)).toBe(30_000);
  });

  it('doubles: 60s → 120s → 240s', () => {
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(4)).toBe(240_000);
  });

  it('caps at 1 hour', () => {
    expect(backoffDelayMs(10)).toBe(3_600_000);
    expect(backoffDelayMs(20)).toBe(3_600_000);
  });
});

// ── reconcileLocalId ───────────────────────────────────────────────
describe('reconcileLocalId', () => {
  let db: Database.Database;

  beforeEach(() => { db = createDB(); });

  it('rewrites matching local_id in payload JSON', () => {
    const LOCAL = 'local-aaa';
    const REAL  = 'server-bbb';
    db.prepare(`
      INSERT INTO pending_sync_ops (id, entity_type, operation, local_id, payload, created_at)
      VALUES ('op1', 'ticket', 'update', ?, ?, ?)
    `).run(LOCAL, JSON.stringify({ ticket_id: LOCAL, note: 'test' }), Date.now());

    const count = reconcileLocalId(db, LOCAL, REAL);
    expect(count).toBeGreaterThan(0);

    const row = db.prepare('SELECT payload FROM pending_sync_ops WHERE id = ?').get('op1') as any;
    expect(JSON.parse(row.payload).ticket_id).toBe(REAL);
  });

  it('is a no-op when localId === remoteId', () => {
    db.prepare(`
      INSERT INTO pending_sync_ops (id, entity_type, operation, local_id, payload, created_at)
      VALUES ('op2', 'customer', 'update', 'same', ?, ?)
    `).run(JSON.stringify({ customer_id: 'same' }), Date.now());

    const count = reconcileLocalId(db, 'same', 'same');
    expect(count).toBe(0);
  });

  it('does not rewrite rows that do not contain the local id', () => {
    db.prepare(`
      INSERT INTO pending_sync_ops (id, entity_type, operation, local_id, payload, created_at)
      VALUES ('op3', 'payment', 'create', 'unrelated', ?, ?)
    `).run(JSON.stringify({ amount: 500 }), Date.now());

    const count = reconcileLocalId(db, 'missing-id', 'server-id');
    expect(count).toBe(0);
  });
});

// ── enqueue + count + breakdown ───────────────────────────────────
describe('SyncOpsEngine.enqueue', () => {
  let db: Database.Database;
  let engine: SyncOpsEngine;

  beforeEach(() => {
    db = createDB();
    engine = makeEngine(db);
  });

  it('inserts a row with attempts=0', () => {
    engine.enqueue({ entity_type: 'ticket', operation: 'create', local_id: 't1', payload: { status: 'waiting' } });
    const row = db.prepare('SELECT * FROM pending_sync_ops').get() as any;
    expect(row).toBeDefined();
    expect(row.attempts).toBe(0);
    expect(row.entity_type).toBe('ticket');
    expect(row.operation).toBe('create');
  });

  it('getPendingCount counts all non-done rows', () => {
    expect(engine.getPendingCount()).toBe(0);
    engine.enqueue({ entity_type: 'ticket', operation: 'create', local_id: 'a', payload: {} });
    engine.enqueue({ entity_type: 'payment', operation: 'create', local_id: 'b', payload: {} });
    expect(engine.getPendingCount()).toBe(2);
  });

  it('getBreakdown returns per-entity counts', () => {
    engine.enqueue({ entity_type: 'ticket', operation: 'update', local_id: 'x', remote_id: 'x', payload: {} });
    engine.enqueue({ entity_type: 'ticket', operation: 'update', local_id: 'y', remote_id: 'y', payload: {} });
    engine.enqueue({ entity_type: 'appointment', operation: 'delete', local_id: 'z', remote_id: 'z', payload: {} });
    const bd = engine.getBreakdown();
    expect(bd.ticket).toBe(2);
    expect(bd.appointment).toBe(1);
    expect(bd.customer).toBe(0);
  });
});

// ── Sync behavior (mocked fetch) ──────────────────────────────────
describe('SyncOpsEngine sync behavior', () => {
  let db: Database.Database;
  let engine: SyncOpsEngine;

  beforeEach(() => {
    db = createDB();
    engine = makeEngine(db);
    vi.stubGlobal('fetch', undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('successful CREATE: sets remote_id from server response', async () => {
    const SERVER_ID = 'server-uuid-001';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ id: SERVER_ID }],
    }));

    engine.enqueue({ entity_type: 'customer', operation: 'create', local_id: 'local-cust-1', payload: { name: 'Alice' } });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_sync_ops').get() as any;
    expect(row.remote_id).toBe(SERVER_ID);
    expect(row.last_error).toBeNull();
  });

  it('successful UPDATE: row is deleted from pending_sync_ops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'server-t1' }],
    }));

    engine.enqueue({ entity_type: 'ticket', operation: 'update', local_id: 'server-t1', remote_id: 'server-t1', payload: { status: 'served' } });
    await engine.retryNow();

    const rows = db.prepare('SELECT * FROM pending_sync_ops').all();
    expect(rows).toHaveLength(0);
  });

  it('successful DELETE: row is deleted from pending_sync_ops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => { throw new Error('no body'); },
    }));

    engine.enqueue({ entity_type: 'appointment', operation: 'delete', local_id: 'appt-1', remote_id: 'appt-1', payload: {} });
    await engine.retryNow();

    const rows = db.prepare('SELECT * FROM pending_sync_ops').all();
    expect(rows).toHaveLength(0);
  });

  it('4xx permanent failure: sets last_error, next_retry_at = NULL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Validation failed' }),
    }));

    engine.enqueue({ entity_type: 'payment', operation: 'create', local_id: 'pay-1', payload: { amount: -1 } });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_sync_ops').get() as any;
    expect(row.last_error).toContain('Validation');
    expect(row.next_retry_at).toBeNull();
  });

  it('5xx transient failure: sets next_retry_at > now (backoff)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Service unavailable' }),
    }));

    engine.enqueue({ entity_type: 'ticket', operation: 'create', local_id: 'tkt-2', payload: {} });
    const before = Date.now();
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_sync_ops').get() as any;
    expect(row.next_retry_at).toBeGreaterThan(before);
    expect(row.last_error).toBeDefined();
  });

  it('network error: treated as transient, retry later', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })
    ));

    engine.enqueue({ entity_type: 'customer', operation: 'update', local_id: 'cust-2', remote_id: 'cust-2', payload: { name: 'Bob' } });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_sync_ops').get() as any;
    expect(row.next_retry_at).toBeDefined();
    expect(row.last_error).toMatch(/fetch|network|error/i);
  });

  it('reconciles localId → serverId in sibling pending payloads on successful create', async () => {
    const LOCAL_CUST = 'local-cust-xyz';
    const SERVER_CUST = 'server-cust-abc';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ id: SERVER_CUST }],
    }));

    // Enqueue customer create
    engine.enqueue({ entity_type: 'customer', operation: 'create', local_id: LOCAL_CUST, payload: { id: LOCAL_CUST, name: 'Charlie' } });
    // Enqueue a ticket that references the local customer id
    engine.enqueue({ entity_type: 'ticket', operation: 'create', local_id: 'tkt-3', payload: { customer_id: LOCAL_CUST } });

    // Only process the customer create row
    const custRow = db.prepare('SELECT * FROM pending_sync_ops WHERE entity_type = ?').get('customer') as any;
    // Manually mark ticket as next_retry_at far future so only customer processes this round
    db.prepare('UPDATE pending_sync_ops SET next_retry_at = ? WHERE entity_type = ?').run(Date.now() + 999_999_999, 'ticket');

    await engine.retryNow();

    // The ticket's payload should now reference the server customer id
    const ticketRow = db.prepare('SELECT payload FROM pending_sync_ops WHERE entity_type = ?').get('ticket') as any;
    if (ticketRow) {
      const parsed = JSON.parse(ticketRow.payload);
      expect(parsed.customer_id).toBe(SERVER_CUST);
    }
    // Customer row should have remote_id set
    const custAfter = db.prepare('SELECT * FROM pending_sync_ops WHERE entity_type = ?').get('customer') as any;
    if (custAfter) expect(custAfter.remote_id).toBe(SERVER_CUST);
  });
});

// ── Integration: offline → online transition ───────────────────────
describe('offline → online integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('drains all queued ops when connectivity is restored', async () => {
    const db = createDB();
    const engine = makeEngine(db);

    // Simulate offline: queue 3 operations
    engine.enqueue({ entity_type: 'ticket', operation: 'create', local_id: 'tkt-a', payload: { status: 'waiting' } });
    engine.enqueue({ entity_type: 'ticket', operation: 'update', local_id: 'tkt-b', remote_id: 'tkt-b', payload: { status: 'served' } });
    engine.enqueue({ entity_type: 'payment', operation: 'create', local_id: 'pay-a', payload: { amount: 1500 } });

    expect(engine.getPendingCount()).toBe(3);

    // Simulate reconnect: all server calls succeed
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, opts: any) => {
      callCount++;
      const method = opts?.method ?? 'GET';
      if (method === 'DELETE' || (method === 'PATCH')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 201, json: async () => [{ id: `server-${callCount}` }] };
    }));

    await engine.retryNow();

    expect(callCount).toBe(3);

    // Create rows should have remote_id; update rows deleted
    const remaining = db.prepare('SELECT * FROM pending_sync_ops').all() as any[];
    const creates = remaining.filter((r: any) => r.operation === 'create');
    expect(creates.every((r: any) => r.remote_id !== null)).toBe(true);
    const updates = remaining.filter((r: any) => r.operation === 'update');
    expect(updates).toHaveLength(0);
  });
});
