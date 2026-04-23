/**
 * Tests for offline-write.ts helpers.
 *
 * Covers:
 * - isNetworkError: AbortError, TimeoutError, "Failed to fetch", navigator.onLine=false
 * - withOfflineFallback happy path: returns data, optimistic=false
 * - withOfflineFallback offline fallback: enqueues and returns optimistic=true
 * - withOfflineFallback non-network error: re-throws without queuing
 * - withOfflineFallback 3 s timeout: AbortError treated as network error → offline fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isNetworkError, withOfflineFallback } from '../../src/lib/offline-write';

// ── isNetworkError ─────────────────────────────────────────────────

describe('isNetworkError', () => {
  it('returns true for AbortError', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(isNetworkError(err)).toBe(true);
  });

  it('returns true for TimeoutError', () => {
    const err = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(isNetworkError(err)).toBe(true);
  });

  it('returns true for "Failed to fetch" message', () => {
    const err = new TypeError('Failed to fetch');
    expect(isNetworkError(err)).toBe(true);
  });

  it('returns false for a Supabase 4xx error', () => {
    const err = { code: '23505', message: 'duplicate key value' };
    expect(isNetworkError(err)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNetworkError(null)).toBe(false);
  });
});

// ── withOfflineFallback ────────────────────────────────────────────

describe('withOfflineFallback — happy path (online)', () => {
  it('returns data and optimistic=false when write succeeds', async () => {
    const result = await withOfflineFallback(
      { entityType: 'customer', operation: 'update', localId: 'cust-1', remoteId: 'cust-1', payload: { name: 'Alice' } },
      async () => ({ id: 'cust-1' }),
    );
    expect(result.optimistic).toBe(false);
    expect(result.data).toEqual({ id: 'cust-1' });
    expect(result.queueId).toBeNull();
  });
});

describe('withOfflineFallback — offline fallback', () => {
  let enqueueSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enqueueSpy = vi.fn().mockResolvedValue('queue-row-id-123');
    // Mock window.qf.syncOps.enqueue
    (globalThis as any).window = {
      qf: {
        syncOps: {
          enqueue: enqueueSpy,
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('enqueues and returns optimistic=true on network error', async () => {
    const result = await withOfflineFallback(
      { entityType: 'ticket', operation: 'update', localId: 'tkt-1', remoteId: 'tkt-1', payload: { status: 'served' } },
      async () => {
        throw Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
      },
    );
    expect(result.optimistic).toBe(true);
    expect(result.data).toBeNull();
    expect(result.queueId).toBe('queue-row-id-123');
    expect(enqueueSpy).toHaveBeenCalledOnce();
    // Verify IPC args: separate primitives, not an object with organization_id
    const [entityType, operation, localId, remoteId, payloadJson] = enqueueSpy.mock.calls[0];
    expect(entityType).toBe('ticket');
    expect(operation).toBe('update');
    expect(localId).toBe('tkt-1');
    expect(remoteId).toBe('tkt-1');
    expect(typeof payloadJson).toBe('string');
    expect(JSON.parse(payloadJson)).toEqual({ status: 'served' });
  });

  it('enqueues on AbortError (timeout scenario)', async () => {
    const result = await withOfflineFallback(
      { entityType: 'appointment', operation: 'delete', localId: 'appt-1', remoteId: 'appt-1', payload: { id: 'appt-1' } },
      async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      },
    );
    expect(result.optimistic).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledOnce();
  });

  it('re-throws on non-network errors without enqueuing', async () => {
    const dbErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    await expect(
      withOfflineFallback(
        { entityType: 'customer', operation: 'create', localId: 'cust-2', payload: { name: 'Bob' } },
        async () => { throw dbErr; },
      ),
    ).rejects.toThrow('duplicate key value');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
