/**
 * offline-write.ts — Shared helper for offline-first Supabase writes.
 *
 * Wraps any Supabase mutation with:
 *  - A 3 s AbortController timeout (prevents hung-network UI freezes).
 *  - Network-error detection (Failed to fetch, AbortError, navigator.onLine).
 *  - On network failure: enqueues the op via window.qf.syncOps.enqueue and
 *    returns an optimistic-success result so the caller's UI stays responsive.
 *  - On non-network errors (4xx validation, auth): re-throws so the UI can
 *    surface the specific error message to the operator.
 *
 * Usage:
 *   const result = await withOfflineFallback(
 *     { entityType: 'customer', operation: 'update', localId: id, payload: patch },
 *     () => sb.from('customers').update(patch).eq('id', id),
 *   );
 *   // result.optimistic === true when the op was queued locally.
 *
 * IPC safety: payload is JSON-serialised and passed as a string — never as an
 * object with organization_id embedded in an object property — to satisfy the
 * Electron IPC serialization rule (see project memory).
 */

export type OfflineEntityType = 'ticket' | 'appointment' | 'customer' | 'order' | 'payment';
export type OfflineOperation  = 'create' | 'update' | 'delete';

export interface OfflineWriteOpts {
  entityType: OfflineEntityType;
  operation:  OfflineOperation;
  /** Client-side UUID for the record being mutated. */
  localId:    string;
  /** Server UUID — only needed for update / delete (already exists remotely). */
  remoteId?:  string | null;
  /** Full mutation payload — must be JSON-serialisable. */
  payload:    Record<string, unknown>;
}

export interface OfflineWriteResult<T = unknown> {
  /** True when the Supabase call succeeded and returned data. */
  data:       T | null;
  /** True when the call was queued offline (no live Supabase round-trip). */
  optimistic: boolean;
  /** The queue row id returned by syncOps.enqueue (only set when optimistic). */
  queueId:    string | null;
}

/** Returns true for errors that indicate the network is down / timed out. */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; code?: string };
  // AbortController timeout or manual abort
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  // Standard fetch failure
  if (typeof e.message === 'string' && e.message.includes('Failed to fetch')) return true;
  // navigator reports offline — only when onLine is explicitly false (not undefined)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

/**
 * Execute a Supabase write with a 3 s timeout and offline fallback.
 *
 * @param opts  - Entity metadata for the queue entry.
 * @param write - Async factory that performs the Supabase operation.
 *                Receives an AbortSignal that times out after 3 s.
 *                The factory must throw on Supabase-level errors.
 */
export async function withOfflineFallback<T = unknown>(
  opts:  OfflineWriteOpts,
  write: (signal: AbortSignal) => Promise<T>,
): Promise<OfflineWriteResult<T>> {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);

  try {
    const data = await write(controller.signal);
    return { data, optimistic: false, queueId: null };

  } catch (err: unknown) {
    clearTimeout(timer);

    if (isNetworkError(err)) {
      // Offline path — enqueue via IPC and return optimistic success.
      let queueId: string | null = null;
      try {
        queueId = await (window as any).qf?.syncOps?.enqueue?.(
          opts.entityType,
          opts.operation,
          opts.localId,
          opts.remoteId ?? null,
          JSON.stringify(opts.payload),
        ) ?? null;
      } catch (qErr) {
        console.warn('[offline-write] syncOps.enqueue failed', qErr);
      }
      return { data: null, optimistic: true, queueId };
    }

    // Non-network error (validation, auth, RLS) — re-throw for the caller.
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
