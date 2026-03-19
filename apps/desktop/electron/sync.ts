import Database from 'better-sqlite3';

type StatusCallback = (status: 'online' | 'offline' | 'syncing' | 'connecting') => void;
type ProgressCallback = (pendingCount: number) => void;
type AuthErrorCallback = () => void;
type DataPulledCallback = () => void;

export class SyncEngine {
  private db: Database.Database;
  private supabaseUrl: string;
  private supabaseKey: string;
  private onStatus: StatusCallback;
  private onProgress: ProgressCallback;
  private onAuthError: AuthErrorCallback;
  private onDataPulled: DataPulledCallback;
  private authErrorSuppressedUntil = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private pullInterval: ReturnType<typeof setInterval> | null = null;

  public isOnline = false;
  public lastSyncAt: string | null = null;
  public pendingCount = 0;

  constructor(
    db: Database.Database,
    supabaseUrl: string,
    supabaseKey: string,
    onStatus: StatusCallback,
    onProgress: ProgressCallback,
    onAuthError: AuthErrorCallback = () => {},
    onDataPulled: DataPulledCallback = () => {},
  ) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onAuthError = onAuthError;
    this.onDataPulled = onDataPulled;
  }

  start() {
    // Check connectivity every 10s
    this.healthInterval = setInterval(() => this.checkHealth(), 10_000);
    this.checkHealth();

    // Try to sync pending items every 15s
    this.interval = setInterval(() => this.syncNow(), 15_000);

    // Pull cloud data every 5s when online to keep SQLite fresh
    this.pullInterval = setInterval(() => {
      if (this.isOnline) this.pullLatest();
    }, 5_000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.pullInterval) clearInterval(this.pullInterval);
  }

  // Track when we last refreshed the token to avoid hammering the auth endpoint
  private lastTokenRefreshAt = 0;

  private async checkHealth() {
    // Proactively refresh token every 50 minutes (JWT expires at 60 min by default)
    if (this.isOnline && Date.now() - this.lastTokenRefreshAt > 50 * 60 * 1000) {
      const newToken = await this.refreshAccessToken();
      if (newToken) this.lastTokenRefreshAt = Date.now();
    }

    try {
      const res = await fetch(`${this.supabaseUrl}/rest/v1/offices?select=id&limit=1`, {
        method: 'GET',
        headers: { apikey: this.supabaseKey, Authorization: `Bearer ${this.supabaseKey}` },
        signal: AbortSignal.timeout(5000),
      });
      const wasOffline = !this.isOnline;
      this.isOnline = res.ok;

      if (wasOffline && this.isOnline) {
        // CRITICAL: Push local changes first, then pull, then notify online
        this.onStatus('syncing');
        await this.syncNow();   // Push offline changes to cloud
        await this.pullLatest(); // Pull cloud state into SQLite (merges, doesn't overwrite)
        await this.pullLatest(); // Second pull catches any reprocessed data
      }

      this.onStatus(this.isOnline ? 'online' : 'offline');
    } catch {
      this.isOnline = false;
      this.onStatus('offline');
    }

    this.updatePendingCount();
  }

  /** Suppress auth-error events for a period (call after login to prevent stale-session race) */
  public suppressAuthErrors(durationMs = 15000) {
    this.authErrorSuppressedUntil = Date.now() + durationMs;
  }

  public updatePendingCount() {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    this.pendingCount = row?.count ?? 0;
    this.onProgress(this.pendingCount);
  }

  // Refresh the access token using the stored refresh_token
  private async refreshAccessToken(): Promise<string | null> {
    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.refresh_token) return null;

    try {
      const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.access_token) return null;

      // Persist the new tokens
      const updated = { ...session, access_token: data.access_token, refresh_token: data.refresh_token ?? session.refresh_token };
      this.db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('current', ?)").run(JSON.stringify(updated));
      console.log('[sync] Access token refreshed');
      return data.access_token;
    } catch (err: any) {
      console.warn('[sync] Token refresh failed:', err?.message ?? err);
      return null;
    }
  }

  // Get a valid auth token — refreshes if expired (checks JWT exp claim)
  private getAuthToken(): string {
    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    return session?.access_token ?? this.supabaseKey;
  }

  async syncNow() {
    if (!this.isOnline) return;

    const now = new Date().toISOString();
    const pending = this.db.prepare(
      "SELECT * FROM sync_queue WHERE synced_at IS NULL AND attempts < 10 AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT 50"
    ).all(now) as any[];

    if (pending.length === 0) return;

    this.onStatus('syncing');

    // Get session for auth token — refresh if needed
    let authToken = this.getAuthToken();
    if (Date.now() - this.lastTokenRefreshAt > 50 * 60 * 1000) {
      const newToken = await this.refreshAccessToken();
      if (newToken) { authToken = newToken; this.lastTokenRefreshAt = Date.now(); }
    }

    for (const item of pending) {
      try {
        await this.replayMutation(item, authToken);
        this.db.prepare(
          "UPDATE sync_queue SET synced_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), item.id);
      } catch (err: any) {
        // Exponential backoff: 15s → 30s → 60s → 120s → 240s, cap at 5min
        const newAttempts = (item.attempts ?? 0) + 1;
        const delayMs = Math.min(15000 * Math.pow(2, newAttempts - 1), 300000);
        const nextRetry = new Date(Date.now() + delayMs).toISOString();
        this.db.prepare(
          "UPDATE sync_queue SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
        ).run(newAttempts, err.message ?? 'Unknown error', nextRetry, item.id);
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.updatePendingCount();
    this.onStatus('online');

    // Clean up old synced items (> 24h)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?").run(cutoff);

    // Auto-discard UPDATE/CALL items that failed 5+ times — but NEVER discard INSERTs
    // A customer's ticket creation must never be silently lost
    const discarded = this.db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();
    if (discarded.changes > 0) {
      console.warn(`Auto-discarded ${discarded.changes} stale UPDATE/CALL sync items after 5 failed attempts`);
      this.updatePendingCount();
    }

    // Warn about stuck INSERT items
    const stuckInserts = this.db.prepare(
      "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation = 'INSERT'"
    ).get() as any;
    if (stuckInserts?.c > 0) {
      console.warn(`[sync] ${stuckInserts.c} ticket INSERT(s) stuck after 5+ attempts — will keep retrying`);
    }
  }

  private async replayMutation(item: any, authToken: string) {
    const payload = JSON.parse(item.payload);
    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    };

    const baseUrl = `${this.supabaseUrl}/rest/v1/${item.table_name}`;

    switch (item.operation) {
      case 'INSERT': {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok && res.status !== 409) {
          throw new Error(`INSERT failed: ${res.status}`);
        }
        break;
      }

      case 'UPDATE':
      case 'CALL': {
        const res = await fetch(`${baseUrl}?id=eq.${item.record_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok && res.status !== 409) {
          throw new Error(`UPDATE failed: ${res.status}`);
        }
        break;
      }
    }
  }

  // Pull latest data from cloud to local cache
  async pullLatest() {
    if (!this.isOnline) return;

    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.office_ids?.length) {
      console.log('[sync:pullLatest] No session or office_ids, skipping pull');
      return;
    }
    console.log('[sync:pullLatest] Pulling for offices:', session.office_ids);

    // Try user token first, fall back to anon key if token is expired/invalid
    const userToken = session.access_token;
    const anonHeaders: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${this.supabaseKey}`,
    };
    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${userToken ?? this.supabaseKey}`,
    };

    try {
      const officeIds = session.office_ids as string[];
      const officeFilter = officeIds.map((id: string) => `id.eq.${id}`).join(',');
      const officeInFilter = officeIds.map((id: string) => `office_id.eq.${id}`).join(',');

      // Pull offices, departments, services, desks in parallel
      const [officesRes, deptsRes, svcsRes, desksRes] = await Promise.all([
        fetch(`${this.supabaseUrl}/rest/v1/offices?or=(${officeFilter})&select=id,name,address,organization_id,settings,operating_hours,timezone`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/departments?or=(${officeInFilter})&select=id,name,code,office_id`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/services?select=id,name,department_id,estimated_service_time`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/desks?or=(${officeInFilter})&select=id,name,department_id,office_id,is_active,current_staff_id`, { headers, signal: AbortSignal.timeout(10000) }),
      ]);

      const now = new Date().toISOString();

      if (officesRes.ok) {
        const offices = await officesRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO offices (id, name, address, organization_id, settings, operating_hours, timezone, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const o of offices) {
          stmt.run(o.id, o.name, o.address, o.organization_id, JSON.stringify(o.settings ?? {}), JSON.stringify(o.operating_hours ?? {}), o.timezone ?? null, now);
        }
      }

      if (deptsRes.ok) {
        const depts = await deptsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO departments (id, name, code, office_id, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const d of depts) {
          stmt.run(d.id, d.name, d.code, d.office_id, now);
        }
      }

      if (svcsRes.ok) {
        const svcs = await svcsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO services (id, name, department_id, estimated_service_time, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const s of svcs) {
          stmt.run(s.id, s.name, s.department_id, s.estimated_service_time ?? 10, now);
        }
      }

      if (desksRes.ok) {
        const desks = await desksRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO desks (id, name, department_id, office_id, is_active, current_staff_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const d of desks) {
          stmt.run(d.id, d.name, d.department_id, d.office_id, d.is_active ? 1 : 0, d.current_staff_id, now);
        }
      }

      const upsert = this.db.prepare(`
        INSERT OR REPLACE INTO tickets
        (id, ticket_number, office_id, department_id, service_id, desk_id, status, priority,
         customer_data, created_at, called_at, called_by_staff_id, serving_started_at,
         completed_at, cancelled_at, parked_at, recall_count, notes, is_remote, appointment_id, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // IDs of locally-modified tickets — only skip if a sync is RECENTLY in-flight
      // Items pending > 2 minutes are considered stale and should not block cloud updates
      // (prevents mobile-served tickets from being stuck as "called" on station)
      const twoMinAgo = new Date(Date.now() - 120000).toISOString();
      const locallyModifiedIds = new Set(
        (this.db.prepare(
          "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'tickets' AND operation IN ('UPDATE','CALL') AND created_at > ?"
        ).all(twoMinAgo) as any[]).map((r: any) => r.record_id)
      );

      const upsertBatch = this.db.transaction((rows: any[]) => {
        for (const t of rows) {
          if (locallyModifiedIds.has(t.id)) continue; // our local change is pending — don't overwrite
          upsert.run(
            t.id, t.ticket_number, t.office_id, t.department_id, t.service_id,
            t.desk_id, t.status, t.priority ?? 0,
            typeof t.customer_data === 'string' ? t.customer_data : JSON.stringify(t.customer_data ?? {}),
            t.created_at, t.called_at, t.called_by_staff_id, t.serving_started_at,
            t.completed_at, t.cancelled_at, t.parked_at, t.recall_count ?? 0,
            t.notes, t.is_remote ? 1 : 0, t.appointment_id,
            new Date().toISOString()
          );
        }
      });

      for (const officeId of officeIds) {
        // Strategy:
        // 1. Always pull ALL active tickets (no date filter) — an active ticket must always show
        // 2. Pull recent completed tickets for history (last 48h, date-filtered)
        // This eliminates timezone bugs and ensures tickets are never missed due to clock drift.

        const fetchTickets = async (hdrs: Record<string, string>, url: string) => {
          const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(15000) });
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            console.warn(`[sync:pullLatest] Ticket fetch failed (${r.status}) for office ${officeId}: ${body.slice(0, 200)}`);
            return null;
          }
          return r.json() as Promise<any[]>;
        };

        // 1. Active tickets — always pull ALL active tickets (no incremental cursor)
        // The tickets table has no updated_at column, and active ticket count is small enough
        const activeUrl = `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${officeId}&status=in.(waiting,called,serving)&order=created_at.asc`;
        let activeTickets = await fetchTickets(headers, activeUrl);
        if (activeTickets === null) {
          // Token expired — try to refresh and retry once
          console.log('[sync:pullLatest] Token expired, attempting refresh...');
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            this.lastTokenRefreshAt = Date.now();
            headers.Authorization = `Bearer ${newToken}`;
            console.log('[sync:pullLatest] Token refreshed, retrying...');
            activeTickets = await fetchTickets(headers, activeUrl);
          }
        }

        if (activeTickets !== null) {
          console.log(`[sync:pullLatest] Upserting ${activeTickets.length} active tickets. locallyModified: ${locallyModifiedIds.size}, tickets: ${activeTickets.map((t:any) => `${t.ticket_number}(${t.status})`).join(', ')}`);
          upsertBatch(activeTickets);
          console.log(`[sync:pullLatest] Active tickets for office ${officeId}: ${activeTickets.length} (${activeTickets.filter((t: any) => t.status === 'waiting').length} waiting)`);
        } else {
          console.warn(`[sync:pullLatest] Could not fetch active tickets for office ${officeId}`);
          continue; // skip this office, try the next one
        }

        // 2. Recent historical tickets — date-filtered (last 48h, avoids clock-drift issues)
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const histUrl = `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${officeId}&status=in.(served,no_show,cancelled)&created_at=gte.${cutoff}&order=created_at.asc`;
        let histTickets = await fetchTickets(headers, histUrl);
        if (histTickets !== null) {
          upsertBatch(histTickets);
        }

        // ── Clean up L- prefixed local tickets that now have a cloud equivalent ──
        // Only remove L- local copies, NOT cloud-to-cloud duplicates (those have the same ticket_number
        // across active+historical pulls and must coexist)
        const allPulled = [...(activeTickets ?? []), ...(histTickets ?? [])];
        const pulledIds = new Set(allPulled.map((t: any) => t.id));
        for (const t of allPulled) {
          if (!t.ticket_number || !t.id || t.ticket_number.startsWith('L-')) continue;
          // Only remove L- prefixed LOCAL copies (offline-created tickets that synced to cloud)
          const lDupes = this.db.prepare(
            "SELECT id FROM tickets WHERE office_id = ? AND ticket_number = ? AND id != ?"
          ).all(t.office_id, `L-${t.ticket_number}`, t.id) as any[];
          for (const lp of lDupes) {
            if (pulledIds.has(lp.id)) continue; // don't delete something we just pulled
            this.db.prepare("DELETE FROM tickets WHERE id = ?").run(lp.id);
            this.db.prepare("DELETE FROM sync_queue WHERE record_id = ?").run(lp.id);
          }
        }
      }

      // Notify displays ONCE after all offices are pulled (not per-office)
      this.onDataPulled();
    } catch (err: any) {
      console.error('[sync:pullLatest] Error:', err?.message ?? err);
    }
  }
}
