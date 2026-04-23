/**
 * sync-signup.ts — Offline-first signup queue engine
 *
 * Handles queuing a signup POST when the cloud is unreachable, then retrying
 * with idempotency when connectivity is restored. Keeps the main SyncEngine
 * untouched (it owns tickets / config sync; this owns signup provisioning only).
 *
 * State machine for each pending_signups row:
 *
 *   queued ──(attempt)──► syncing ──(success)──► synced
 *                │                  │
 *                │                  └──(4xx auth)──► failed
 *                │
 *                └──(network error / 5xx) → back to queued (bump attempt_count)
 *
 * Exponential backoff: Math.min(2^attempt_count * 30s, 1h)
 * Idempotency: the row id (UUID) is sent as Idempotency-Key header so the server
 * returns the already-created org on retries instead of creating a duplicate.
 * After success: reconcileOrgId() walks all local tables and rewrites tempOrgId →
 * the real server-assigned org id.
 */

import Database from 'better-sqlite3';

// Inline lightweight logger so sync-signup.ts does not pull in the Electron
// `app` dependency (which is unavailable in Vitest / Node test runs).
const log = {
  info: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.info(`[INFO] [${tag}]`, msg, ctx ?? ''),
  warn: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[WARN] [${tag}]`, msg, ctx ?? ''),
  error: (tag: string, msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[ERROR] [${tag}]`, msg, ctx ?? ''),
};

// All tables that carry an organization_id column (direct or via office chain).
// reconcileOrgId updates each in a single transaction so no orphaned rows remain.
const ORG_ID_TABLES: Array<{ table: string; column: string }> = [
  { table: 'organizations', column: 'id' },
  { table: 'offices', column: 'organization_id' },
  { table: 'departments', column: 'organization_id' },
  { table: 'services', column: 'organization_id' },
  { table: 'desks', column: 'organization_id' },
  { table: 'staff', column: 'organization_id' },
  { table: 'tickets', column: 'organization_id' },
  { table: 'ticket_items', column: 'organization_id' },
  { table: 'ticket_payments', column: 'organization_id' },
  { table: 'menu_categories', column: 'organization_id' },
  { table: 'menu_items', column: 'organization_id' },
  { table: 'broadcast_templates', column: 'organization_id' },
  { table: 'sync_queue', column: 'organization_id' },
  { table: 'virtual_queue_codes', column: 'organization_id' },
];

// Some tables may not exist on all installations — we check before updating.
function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return !!row;
}

/** Returns true if the given column exists in the table. */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Walk all local SQLite tables that reference tempId as an org identifier
 * and replace every occurrence with realId. Runs as individual statements
 * (each guarded by tableExists + columnExists so missing schema is skipped
 * gracefully). Uses a wrapping transaction for atomicity on tables that do
 * exist; per-table try/catch is not safe inside better-sqlite3 transactions
 * so we pre-flight the schema before touching each table.
 *
 * Exported so tests can exercise it independently.
 */
export function reconcileOrgId(
  db: Database.Database,
  tempId: string,
  realId: string,
): { table: string; updated: number }[] {
  const results: { table: string; updated: number }[] = [];

  // Pre-flight: build list of (table, column) pairs that actually exist on this DB.
  // Done outside the transaction so schema lookups don't hold a write lock.
  const eligible: Array<{ table: string; column: string }> = [];
  for (const { table, column } of ORG_ID_TABLES) {
    if (!tableExists(db, table)) continue;
    if (!columnExists(db, table, column)) {
      log.warn('sync-signup.reconcile', `Column ${table}.${column} missing — skipping`, {});
      continue;
    }
    eligible.push({ table, column });
  }

  // Execute all updates in a single transaction.
  db.transaction(() => {
    for (const { table, column } of eligible) {
      const r = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(realId, tempId);
      if (r.changes > 0) {
        results.push({ table, updated: r.changes });
        log.info('sync-signup.reconcile', `Reconciled ${r.changes} row(s) in ${table}`, { tempId: tempId.slice(0, 8), realId: realId.slice(0, 8) });
      }
    }

    // Also rewrite payloads in sync_queue that embed the tempId in the JSON body.
    // Only attempt if the payload column exists (it always does on a healthy schema).
    if (tableExists(db, 'sync_queue') && columnExists(db, 'sync_queue', 'payload')) {
      const rows = db.prepare(
        `SELECT id, payload FROM sync_queue WHERE synced_at IS NULL AND payload LIKE ?`
      ).all(`%${tempId}%`) as Array<{ id: string; payload: string }>;

      for (const row of rows) {
        try {
          const updated = row.payload.replaceAll(tempId, realId);
          if (updated !== row.payload) {
            db.prepare(`UPDATE sync_queue SET payload = ? WHERE id = ?`).run(updated, row.id);
          }
        } catch { /* malformed payload — skip row */ }
      }
    }
  })();

  return results;
}

/**
 * Exponential backoff delay in milliseconds.
 * 0 attempts → 0ms (immediate first try),
 * 1 attempt   → 30s,
 * 2 attempts  → 60s,
 * ...capped at 1 hour.
 */
export function backoffDelayMs(attemptCount: number): number {
  if (attemptCount === 0) return 0;
  return Math.min(Math.pow(2, attemptCount - 1) * 30_000, 3_600_000);
}

/**
 * Returns true if the next retry is due now (or the row has never been attempted).
 */
function isRetryDue(row: PendingSignup): boolean {
  if (!row.last_attempted_at) return true;
  const lastMs = new Date(row.last_attempted_at).getTime();
  const delay = backoffDelayMs(row.attempt_count);
  return Date.now() >= lastMs + delay;
}

export interface PendingSignup {
  id: string;
  payload: string;
  created_at: string;
  last_attempted_at: string | null;
  attempt_count: number;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
  error_message: string | null;
  synced_org_id: string | null;
}

export class SignupSyncEngine {
  private db: Database.Database;
  private cloudUrl: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private syncInFlight = false;
  // Concurrent-attempt guard: only one sync loop at a time
  private concurrentGuard = new Set<string>();

  constructor(db: Database.Database, cloudUrl: string) {
    this.db = db;
    this.cloudUrl = cloudUrl;
  }

  start() {
    if (this.interval) clearInterval(this.interval);
    // Check every 30 seconds. Individual rows use their own backoff check.
    this.interval = setInterval(() => { void this.trySync(); }, 30_000);
    // Attempt immediately on start in case we're coming back online
    void this.trySync();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Force-retry all queued rows, ignoring backoff. Used by UI "Retry now" button. */
  async retryNow(): Promise<void> {
    await this.trySync(true);
  }

  /**
   * Queue a new signup payload for offline retry.
   * Returns the tempOrgId (the row's UUID) that callers use as a local org placeholder.
   */
  enqueue(
    tempOrgId: string,
    payload: Record<string, unknown>,
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO pending_signups (id, payload, created_at, status)
      VALUES (?, ?, ?, 'queued')
    `).run(tempOrgId, JSON.stringify(payload), now);
    log.info('sync-signup', 'Signup queued for offline retry', { id: tempOrgId.slice(0, 8) });
  }

  /** Returns all rows in the queued/syncing/failed state for UI display. */
  getPendingRows(): PendingSignup[] {
    return this.db.prepare(
      `SELECT * FROM pending_signups WHERE status IN ('queued','syncing','failed') ORDER BY created_at ASC`
    ).all() as PendingSignup[];
  }

  /** Returns the count of rows still needing sync (queued or syncing). */
  getPendingCount(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM pending_signups WHERE status IN ('queued','syncing')`
    ).get() as { n: number };
    return row.n;
  }

  private async trySync(forceRetry = false): Promise<void> {
    if (this.syncInFlight) return;
    this.syncInFlight = true;
    try {
      const rows = this.db.prepare(
        `SELECT * FROM pending_signups WHERE status IN ('queued','syncing') ORDER BY created_at ASC`
      ).all() as PendingSignup[];

      for (const row of rows) {
        if (!forceRetry && !isRetryDue(row)) continue;
        if (this.concurrentGuard.has(row.id)) continue;
        this.concurrentGuard.add(row.id);
        try {
          await this.attemptRow(row);
        } finally {
          this.concurrentGuard.delete(row.id);
        }
      }
    } catch (err: any) {
      log.error('sync-signup', 'trySync error', { error: err?.message });
    } finally {
      this.syncInFlight = false;
    }
  }

  private async attemptRow(row: PendingSignup): Promise<void> {
    const now = new Date().toISOString();

    // Mark syncing
    this.db.prepare(
      `UPDATE pending_signups SET status='syncing', last_attempted_at=?, attempt_count=attempt_count+1 WHERE id=?`
    ).run(now, row.id);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      this.markFailed(row.id, 'Invalid JSON payload');
      return;
    }

    try {
      const res = await fetch(`${this.cloudUrl}/api/onboarding/create-business`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': row.id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });

      const body = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (res.ok) {
        const realOrgId = body.organization_id as string | undefined;
        if (!realOrgId) {
          this.markFailed(row.id, 'Server response missing organization_id');
          return;
        }
        // Mark synced and store the server-assigned org id
        this.db.prepare(
          `UPDATE pending_signups SET status='synced', synced_org_id=?, error_message=NULL WHERE id=?`
        ).run(realOrgId, row.id);
        log.info('sync-signup', 'Signup synced successfully', { tempId: row.id.slice(0, 8), realOrgId: realOrgId.slice(0, 8) });

        // Reconcile local rows: replace tempOrgId with the real org id
        if (realOrgId !== row.id) {
          try {
            reconcileOrgId(this.db, row.id, realOrgId);
          } catch (err: any) {
            // Reconciliation failure is non-fatal — the sync succeeded; log for triage.
            log.error('sync-signup', 'reconcileOrgId failed after sync', { error: err?.message });
          }
        }
      } else if (res.status >= 400 && res.status < 500) {
        // Auth or validation error — not retryable
        const errorMsg = (body?.error as string) || `HTTP ${res.status}`;
        this.markFailed(row.id, errorMsg);
        log.warn('sync-signup', 'Signup failed with client error (not retrying)', { status: res.status, error: errorMsg });
      } else {
        // 5xx or unexpected — leave as queued so backoff applies
        this.markQueued(row.id, `HTTP ${res.status}: ${(body?.error as string) ?? 'server error'}`);
      }
    } catch (err: any) {
      // Network error (timeout, DNS, etc.) — leave as queued
      const msg = err?.name === 'TimeoutError' ? 'Request timed out' : (err?.message ?? 'Network error');
      this.markQueued(row.id, msg);
      log.warn('sync-signup', 'Signup attempt failed (will retry)', { id: row.id.slice(0, 8), error: msg });
    }
  }

  private markFailed(id: string, errorMsg: string) {
    this.db.prepare(
      `UPDATE pending_signups SET status='failed', error_message=? WHERE id=?`
    ).run(errorMsg, id);
  }

  private markQueued(id: string, errorMsg: string) {
    this.db.prepare(
      `UPDATE pending_signups SET status='queued', error_message=? WHERE id=?`
    ).run(errorMsg, id);
  }
}
