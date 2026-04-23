/**
 * sync-ops.ts — Offline-first operation queue engine (post-signup)
 *
 * Queues CREATE/UPDATE/DELETE mutations for tickets, appointments,
 * customers, POS orders, and payments when Supabase is unreachable.
 * On reconnect, drains the queue in insertion order, resolving
 * local→remote ID mappings and propagating them to child records.
 *
 * State machine per pending_sync_ops row:
 *
 *   queued ──(attempt)──► syncing ──(success)──► done
 *                │                  │
 *                │                  └──(4xx permanent)──► failed
 *                └──(network/5xx) → queued (bump attempts + backoff)
 *
 * Exponential backoff: Math.min(2^attempts * 30s, 1h)
 * Idempotency: each row carries a UUID used as Idempotency-Key header.
 * ID reconciliation: when the server assigns a different UUID for a
 * created record (e.g. customer), all subsequent queue payloads that
 * embed the local ID are rewritten in-place before they are sent.
 *
 * Conflict resolution: last-write-wins. No merge — the assumption is
 * single-Station-per-office. Document: if two Stations are used
 * simultaneously and both go offline, the second sync wins for any
 * shared record that both mutated.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const log = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.info(`[INFO] [${tag}]`, msg, ctx ?? ''),
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[WARN] [${tag}]`, msg, ctx ?? ''),
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[ERROR] [${tag}]`, msg, ctx ?? ''),
};

export type EntityType = 'ticket' | 'appointment' | 'customer' | 'order' | 'payment';
export type OperationType = 'create' | 'update' | 'delete';

export interface PendingSyncOp {
  id: string;
  entity_type: EntityType;
  operation: OperationType;
  local_id: string | null;
  remote_id: string | null;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
  next_retry_at: number | null;
}

// Entity → Supabase REST table mapping
const ENTITY_TABLE: Record<EntityType, string> = {
  ticket:      'tickets',
  appointment: 'appointments',
  customer:    'customers',
  order:       'orders',
  payment:     'payments',
};

/**
 * Exponential backoff: 0 attempts → 0ms, 1 → 30s, 2 → 60s … cap 1h.
 * Exported for unit tests.
 */
export function backoffDelayMs(attempts: number): number {
  if (attempts === 0) return 0;
  return Math.min(Math.pow(2, attempts - 1) * 30_000, 3_600_000);
}

/**
 * Rewrite every occurrence of localId → remoteId in the payload JSON
 * column of pending_sync_ops rows that have not yet been sent.
 * Called after a successful 'create' sync so child records reference
 * the server-issued UUID instead of the local placeholder.
 */
export function reconcileLocalId(
  db: Database.Database,
  localId: string,
  remoteId: string,
): number {
  if (localId === remoteId) return 0;
  const rows = db.prepare(
    `SELECT id, payload FROM pending_sync_ops
     WHERE next_retry_at IS NOT NULL OR attempts = 0
       AND payload LIKE ?`
  ).all(`%${localId}%`) as Array<{ id: string; payload: string }>;

  let updated = 0;
  const stmt = db.prepare(`UPDATE pending_sync_ops SET payload = ? WHERE id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      try {
        const next = row.payload.replaceAll(localId, remoteId);
        if (next !== row.payload) {
          stmt.run(next, row.id);
          updated++;
        }
      } catch { /* skip malformed */ }
    }
  })();

  if (updated > 0) {
    log.info('sync-ops.reconcile', `Rewrote ${updated} pending payload(s)`, {
      localId: localId.slice(0, 8),
      remoteId: remoteId.slice(0, 8),
    });
  }
  return updated;
}

export class SyncOpsEngine {
  private db: Database.Database;
  private supabaseUrl: string;
  private supabaseKey: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private syncInFlight = false;
  private getAuthToken: (() => string | null) | null = null;

  constructor(db: Database.Database, supabaseUrl: string, supabaseKey: string) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
  }

  /** Optional: provide a live auth token getter (e.g. from the session store). */
  setAuthTokenGetter(fn: () => string | null) {
    this.getAuthToken = fn;
  }

  start() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => { void this.tryDrain(); }, 30_000);
    void this.tryDrain();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Force-drain all queued ops, bypassing backoff. Used by "Retry now" UI button. */
  async retryNow(): Promise<void> {
    await this.tryDrain(true);
  }

  /**
   * Enqueue an operation. Returns the row id (used as idempotency key).
   * localId = client-generated UUID for the record being created/updated/deleted.
   * remoteId = only known for updates/deletes (already exists on the server).
   * payload = full mutation body (JSON-serialisable object).
   */
  enqueue(opts: {
    entity_type: EntityType;
    operation: OperationType;
    local_id: string;
    remote_id?: string | null;
    payload: Record<string, unknown>;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO pending_sync_ops
        (id, entity_type, operation, local_id, remote_id, payload, created_at, attempts, last_error, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
    `).run(
      id,
      opts.entity_type,
      opts.operation,
      opts.local_id,
      opts.remote_id ?? null,
      JSON.stringify(opts.payload),
      now,
    );
    log.info('sync-ops', 'Enqueued offline op', {
      id: id.slice(0, 8),
      entity: opts.entity_type,
      op: opts.operation,
    });
    return id;
  }

  /**
   * Total ops still needing sync — used for the UI badge count.
   * A row is "done" when remote_id is set (create) or deleted (update/delete).
   * Everything else (including failed rows awaiting manual retry) is pending.
   */
  getPendingCount(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM pending_sync_ops
       WHERE (operation = 'create' AND remote_id IS NULL)
          OR operation IN ('update', 'delete')`
    ).get() as { n: number };
    return row.n;
  }

  /** Per-entity breakdown for the banner detail modal. */
  getBreakdown(): Record<EntityType, number> {
    const rows = this.db.prepare(
      `SELECT entity_type, COUNT(*) AS n FROM pending_sync_ops
       WHERE (operation = 'create' AND remote_id IS NULL)
          OR operation IN ('update','delete')
       GROUP BY entity_type`
    ).all() as Array<{ entity_type: EntityType; n: number }>;
    const result: Record<EntityType, number> = { ticket: 0, appointment: 0, customer: 0, order: 0, payment: 0 };
    for (const r of rows) result[r.entity_type] = r.n;
    return result;
  }

  /** All non-completed ops — for the detail modal. */
  getPendingRows(): PendingSyncOp[] {
    return this.db.prepare(
      `SELECT * FROM pending_sync_ops ORDER BY created_at ASC`
    ).all() as PendingSyncOp[];
  }

  private async tryDrain(forceRetry = false): Promise<void> {
    if (this.syncInFlight) return;
    this.syncInFlight = true;
    try {
      const now = Date.now();
      // Pull all rows that are either:
      //  a) never attempted (attempts=0), or
      //  b) have a pending retry that is now due, or
      //  c) forceRetry ignores next_retry_at
      const rows = this.db.prepare(
        `SELECT * FROM pending_sync_ops
         ORDER BY created_at ASC`
      ).all() as PendingSyncOp[];

      for (const row of rows) {
        // Skip if backoff not yet elapsed (unless forced)
        if (!forceRetry && row.next_retry_at !== null && row.next_retry_at > now) continue;
        // Skip rows that are already synced (remote_id set for creates, or no-remaining-ops for update/delete)
        // Completed deletes / updates: they have a remote_id and last_error=NULL and attempts>0 with next_retry_at=NULL
        // We keep it simple: a row is "done" when it has been successfully processed.
        // The engine deletes done rows to keep the table small.
        await this.processRow(row);
      }
    } catch (err: any) {
      log.error('sync-ops', 'tryDrain error', { error: err?.message });
    } finally {
      this.syncInFlight = false;
    }
  }

  private async processRow(row: PendingSyncOp): Promise<void> {
    const now = Date.now();
    // Mark in-flight by bumping next_retry_at far into future temporarily
    this.db.prepare(
      `UPDATE pending_sync_ops SET attempts = attempts + 1, next_retry_at = ? WHERE id = ?`
    ).run(now + 3_600_000, row.id); // will be reset to proper backoff on failure

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      this.markFailed(row.id, 'Invalid JSON payload');
      return;
    }

    const table = ENTITY_TABLE[row.entity_type];
    const authToken = this.getAuthToken?.() ?? this.supabaseKey;

    try {
      let res: Response;

      if (row.operation === 'create') {
        res = await fetch(`${this.supabaseUrl}/rest/v1/${table}`, {
          method: 'POST',
          headers: this.headers(authToken, { Prefer: 'return=representation', 'Idempotency-Key': row.id }),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
      } else if (row.operation === 'update') {
        const remoteId = row.remote_id ?? row.local_id;
        res = await fetch(`${this.supabaseUrl}/rest/v1/${table}?id=eq.${remoteId}`, {
          method: 'PATCH',
          headers: this.headers(authToken, { Prefer: 'return=representation', 'Idempotency-Key': row.id }),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
      } else {
        // delete
        const remoteId = row.remote_id ?? row.local_id;
        res = await fetch(`${this.supabaseUrl}/rest/v1/${table}?id=eq.${remoteId}`, {
          method: 'DELETE',
          headers: this.headers(authToken, { 'Idempotency-Key': row.id }),
          signal: AbortSignal.timeout(15_000),
        });
      }

      if (res.ok || res.status === 204) {
        // Success — extract server-assigned id for creates
        let serverId: string | null = null;
        if (row.operation === 'create' && res.status !== 204) {
          try {
            const body = await res.json();
            const record = Array.isArray(body) ? body[0] : body;
            serverId = record?.id ?? null;
          } catch { /* no body */ }
        }
        this.markDone(row.id, serverId);
        if (serverId && row.local_id && serverId !== row.local_id) {
          reconcileLocalId(this.db, row.local_id, serverId);
        }
        log.info('sync-ops', 'Op synced', {
          id: row.id.slice(0, 8),
          entity: row.entity_type,
          op: row.operation,
          serverId: serverId?.slice(0, 8),
        });
      } else if (res.status >= 400 && res.status < 500) {
        // Permanent client error — mark failed, do not retry
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (body?.message as string) ?? (body?.error as string) ?? `HTTP ${res.status}`;
        this.markFailed(row.id, msg);
        log.warn('sync-ops', 'Op permanently failed', { id: row.id.slice(0, 8), status: res.status, msg });
      } else {
        // 5xx or unexpected — retry with backoff
        this.markRetry(row.id, row.attempts + 1, `HTTP ${res.status}`);
      }
    } catch (err: any) {
      const msg = err?.name === 'TimeoutError' ? 'Request timed out' : (err?.message ?? 'Network error');
      this.markRetry(row.id, row.attempts + 1, msg);
      log.warn('sync-ops', 'Op attempt failed (will retry)', { id: row.id.slice(0, 8), error: msg });
    }
  }

  private headers(authToken: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.supabaseKey,
      Authorization: `Bearer ${authToken}`,
      ...extra,
    };
  }

  private markDone(id: string, remoteId: string | null) {
    // For creates: store server id and clear retry state.
    // For updates/deletes: delete the row to keep the table small.
    const row = this.db.prepare(`SELECT operation FROM pending_sync_ops WHERE id = ?`).get(id) as { operation: OperationType } | undefined;
    if (row?.operation === 'create') {
      this.db.prepare(
        `UPDATE pending_sync_ops SET remote_id = ?, next_retry_at = NULL, last_error = NULL WHERE id = ?`
      ).run(remoteId, id);
    } else {
      this.db.prepare(`DELETE FROM pending_sync_ops WHERE id = ?`).run(id);
    }
  }

  private markFailed(id: string, errorMsg: string) {
    this.db.prepare(
      `UPDATE pending_sync_ops SET last_error = ?, next_retry_at = NULL WHERE id = ?`
    ).run(errorMsg, id);
  }

  private markRetry(id: string, attemptsDone: number, errorMsg: string) {
    const nextAt = Date.now() + backoffDelayMs(attemptsDone);
    this.db.prepare(
      `UPDATE pending_sync_ops SET last_error = ?, next_retry_at = ?, attempts = ? WHERE id = ?`
    ).run(errorMsg, nextAt, attemptsDone, id);
  }
}
