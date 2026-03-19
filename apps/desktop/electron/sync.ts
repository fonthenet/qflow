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

  // ── Token management ──────────────────────────────────────────────
  // Single source of truth for the current valid access token
  private cachedAccessToken: string | null = null;
  private lastTokenRefreshAt = 0;
  private tokenRefreshInFlight: Promise<string | null> | null = null;
  private consecutiveRefreshFailures = 0;

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

  private realtimeWs: WebSocket | null = null;
  private realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private autoResolveInterval: ReturnType<typeof setInterval> | null = null;

  start() {
    // Check connectivity every 10s
    this.healthInterval = setInterval(() => this.checkHealth(), 10_000);
    this.checkHealth();

    // Try to sync pending items every 15s
    this.interval = setInterval(() => this.syncNow(), 15_000);

    // Pull cloud data every 5s when online to keep SQLite fresh (fallback for when Realtime is down)
    this.pullInterval = setInterval(() => {
      if (this.isOnline) this.pullLatest();
    }, 5_000);

    // Auto-resolve stale tickets every 60s (server-side cleanup runs too, this is belt-and-suspenders)
    this.autoResolveInterval = setInterval(() => {
      if (this.isOnline) this.triggerAutoResolve();
    }, 60_000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.pullInterval) clearInterval(this.pullInterval);
    if (this.autoResolveInterval) clearInterval(this.autoResolveInterval);
    this.disconnectRealtime();
  }

  // ── Supabase Realtime: instant cloud→station push ──────────────
  // When mobile/web updates a ticket in Supabase, the station hears it immediately
  // via WebSocket instead of waiting for the next 5s poll.

  private connectRealtime() {
    if (this.realtimeWs) return; // already connected

    const sessionRow = this.db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.office_ids?.length) return;

    const wsUrl = this.supabaseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    const token = session.access_token ?? this.supabaseKey;

    try {
      const ws = new WebSocket(
        `${wsUrl}/realtime/v1/websocket?apikey=${this.supabaseKey}&vsn=1.0.0`
      );

      ws.onopen = () => {
        console.log('[realtime] Connected to Supabase Realtime');
        // Join the tickets channel for our offices
        const joinMsg = JSON.stringify({
          topic: `realtime:public:tickets`,
          event: 'phx_join',
          payload: { config: { broadcast: { self: false }, postgres_changes: [
            { event: '*', schema: 'public', table: 'tickets', filter: `office_id=in.(${session.office_ids.join(',')})` }
          ] } },
          ref: '1',
        });
        ws.send(joinMsg);

        // Heartbeat every 30s to keep connection alive
        const hb = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
          } else {
            clearInterval(hb);
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.event === 'postgres_changes' || msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
            console.log(`[realtime] Ticket change detected: ${msg.event}`);
            // Immediately pull + notify
            this.pullLatest();
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        console.log('[realtime] Disconnected, will retry in 5s');
        this.realtimeWs = null;
        this.realtimeRetryTimer = setTimeout(() => {
          if (this.isOnline) this.connectRealtime();
        }, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };

      this.realtimeWs = ws;
    } catch (err: any) {
      console.warn('[realtime] Failed to connect:', err?.message);
    }
  }

  private disconnectRealtime() {
    if (this.realtimeRetryTimer) clearTimeout(this.realtimeRetryTimer);
    if (this.realtimeWs) {
      try { this.realtimeWs.close(); } catch { /* ignore */ }
      this.realtimeWs = null;
    }
  }

  private async checkHealth() {
    // Proactively refresh token every 50 minutes (JWT expires at 60 min by default)
    if (this.isOnline && Date.now() - this.lastTokenRefreshAt > 50 * 60 * 1000) {
      await this.ensureFreshToken();
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
        this.connectRealtime(); // Subscribe to live cloud changes
      }

      // Ensure Realtime is connected when online
      if (this.isOnline && !this.realtimeWs) {
        this.connectRealtime();
      } else if (!this.isOnline && this.realtimeWs) {
        this.disconnectRealtime();
      }

      this.onStatus(this.isOnline ? 'online' : 'offline');
    } catch {
      this.isOnline = false;
      this.onStatus('offline');
      this.disconnectRealtime();
    }

    this.updatePendingCount();
  }

  /** Suppress auth-error events for a period (call after login to prevent stale-session race) */
  public suppressAuthErrors(durationMs = 15000) {
    this.authErrorSuppressedUntil = Date.now() + durationMs;
    this.consecutiveRefreshFailures = 0;
    // Invalidate cached token so next sync picks up the fresh login token
    this.cachedAccessToken = null;
    this.lastTokenRefreshAt = 0;
  }

  public updatePendingCount() {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    this.pendingCount = row?.count ?? 0;
    this.onProgress(this.pendingCount);
  }

  // ── Bulletproof Token Management ─────────────────────────────────
  // Decodes JWT to check if it's expired (with 60s safety buffer)
  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      // Expired if exp is in the past (with 60s buffer for clock drift)
      return !payload.exp || (payload.exp * 1000) < (Date.now() + 60000);
    } catch {
      return true; // can't decode = treat as expired
    }
  }

  // Read session from DB
  private getSessionFromDB(): any {
    const row = this.db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    return row ? JSON.parse(row.value) : null;
  }

  // Core refresh — calls Supabase auth endpoint with refresh_token
  private async refreshAccessToken(): Promise<string | null> {
    const session = this.getSessionFromDB();
    if (!session?.refresh_token) {
      console.warn('[sync:token] No refresh_token in session — user must re-login');
      return null;
    }

    try {
      console.log('[sync:token] Refreshing access token...');
      const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[sync:token] Refresh failed (${res.status}): ${body.slice(0, 200)}`);
        // If refresh_token itself is expired/revoked, Supabase returns 400 or 401
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          this.consecutiveRefreshFailures++;
          if (this.consecutiveRefreshFailures >= 3 && Date.now() > this.authErrorSuppressedUntil) {
            console.error('[sync:token] Refresh token is dead after 3 attempts — prompting re-login');
            this.onAuthError();
          }
        }
        return null;
      }

      const data = await res.json();
      if (!data.access_token) return null;

      // Persist both new access_token AND new refresh_token to session
      const updated = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? session.refresh_token,
      };
      this.db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('current', ?)").run(JSON.stringify(updated));

      // Update in-memory cache
      this.cachedAccessToken = data.access_token;
      this.lastTokenRefreshAt = Date.now();
      this.consecutiveRefreshFailures = 0;

      console.log('[sync:token] ✓ Access token refreshed successfully');
      return data.access_token;
    } catch (err: any) {
      console.warn('[sync:token] Token refresh network error:', err?.message ?? err);
      return null;
    }
  }

  // Ensures we have a non-expired access token. Deduplicates concurrent calls.
  async ensureFreshToken(): Promise<string> {
    // 1. Check cached token first
    if (this.cachedAccessToken && !this.isTokenExpired(this.cachedAccessToken)) {
      return this.cachedAccessToken;
    }

    // 2. Check session DB (login may have stored a fresh token)
    const session = this.getSessionFromDB();
    const dbToken = session?.access_token;
    if (dbToken && !this.isTokenExpired(dbToken)) {
      this.cachedAccessToken = dbToken;
      return dbToken;
    }

    // 3. Token is expired — need to refresh
    // Deduplicate: if a refresh is already in flight, wait for it
    if (this.tokenRefreshInFlight) {
      const result = await this.tokenRefreshInFlight;
      if (result) return result;
      // Refresh in flight failed — fall through to return best effort
    } else {
      // Start a refresh
      this.tokenRefreshInFlight = this.refreshAccessToken().finally(() => {
        this.tokenRefreshInFlight = null;
      });
      const result = await this.tokenRefreshInFlight;
      if (result) return result;
    }

    // 4. Refresh failed — return whatever we have (will 401, handled by caller)
    console.warn('[sync:token] Could not get fresh token — sync will likely fail');
    return dbToken ?? this.supabaseKey;
  }

  /**
   * Fire-and-forget: immediately push a specific sync_queue item to Supabase.
   * Called right after a local mutation to minimize cloud display lag.
   * If it fails, the regular syncNow() timer picks it up later.
   */
  async pushImmediate(syncQueueId: string) {
    if (!this.isOnline) return;

    const item = this.db.prepare(
      "SELECT * FROM sync_queue WHERE id = ? AND synced_at IS NULL"
    ).get(syncQueueId) as any;
    if (!item) return;

    try {
      const authToken = await this.ensureFreshToken();
      const result = await this.replayMutation(item, authToken);

      if (result.status === 0) {
        this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
          .run(new Date().toISOString(), item.id);
        this.updatePendingCount();
        console.log(`[sync:pushImmediate] ✓ Pushed ${item.operation} on ${item.table_name}/${item.record_id}`);
      } else if (result.status === 401) {
        // Token expired — force refresh and retry once
        this.cachedAccessToken = null;
        const newToken = await this.refreshAccessToken();
        if (newToken) {
          const retry = await this.replayMutation(item, newToken);
          if (retry.status === 0) {
            this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
              .run(new Date().toISOString(), item.id);
            this.updatePendingCount();
            console.log(`[sync:pushImmediate] ✓ Pushed after token refresh`);
          }
        }
      }
      // Any other failure is silently ignored — syncNow() will retry later
    } catch (err: any) {
      console.log(`[sync:pushImmediate] Will retry later: ${err?.message ?? err}`);
    }
  }

  async syncNow() {
    if (!this.isOnline) return;

    const now = new Date().toISOString();
    const pending = this.db.prepare(
      "SELECT * FROM sync_queue WHERE synced_at IS NULL AND attempts < 10 AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT 50"
    ).all(now) as any[];

    if (pending.length === 0) return;

    this.onStatus('syncing');

    // ── BULLETPROOF: Get a verified-fresh token before replaying anything ──
    let authToken = await this.ensureFreshToken();
    let tokenIsVerified = !this.isTokenExpired(authToken);

    if (!tokenIsVerified) {
      console.warn('[sync:syncNow] Token is expired and refresh failed — will attempt mutations anyway');
    }

    let had401 = false;
    let successCount = 0;

    for (const item of pending) {
      try {
        const result = await this.replayMutation(item, authToken);

        if (result.status === 401) {
          // ── 401: Token died mid-sync — refresh once and retry this item ──
          if (!had401) {
            had401 = true;
            console.log('[sync:syncNow] Got 401 — forcing token refresh and retrying...');
            // Force refresh (bypass cache)
            this.cachedAccessToken = null;
            const newToken = await this.refreshAccessToken();
            if (newToken) {
              authToken = newToken;
              // Retry this item with fresh token
              const retry = await this.replayMutation(item, authToken);
              if (retry.status === 0) {
                this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
                  .run(new Date().toISOString(), item.id);
                successCount++;
                continue;
              }
            }
            // Refresh failed or retry still 401 — mark as auth error, don't waste more attempts
            const newAttempts = (item.attempts ?? 0) + 1;
            this.db.prepare(
              "UPDATE sync_queue SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
            ).run(newAttempts, 'AUTH_EXPIRED: token refresh failed — re-login required', new Date(Date.now() + 60000).toISOString(), item.id);

            // Fire auth error so UI can prompt re-login (but only if not suppressed)
            if (Date.now() > this.authErrorSuppressedUntil) {
              this.onAuthError();
            }
            // Skip remaining items — they'll all 401 too
            break;
          } else {
            // Already tried refresh once this cycle — skip remaining
            break;
          }
        }

        if (result.status !== 0) {
          throw new Error(`${item.operation} failed: ${result.status}`);
        }

        // ✓ Success
        this.db.prepare(
          "UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?"
        ).run(new Date().toISOString(), item.id);
        successCount++;
      } catch (err: any) {
        // Non-auth error: exponential backoff
        const newAttempts = (item.attempts ?? 0) + 1;
        const delayMs = Math.min(15000 * Math.pow(2, newAttempts - 1), 300000);
        const nextRetry = new Date(Date.now() + delayMs).toISOString();
        this.db.prepare(
          "UPDATE sync_queue SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
        ).run(newAttempts, err.message ?? 'Unknown error', nextRetry, item.id);
      }
    }

    if (successCount > 0) {
      console.log(`[sync:syncNow] ✓ Successfully synced ${successCount}/${pending.length} items`);
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
      console.warn(`[sync] Auto-discarded ${discarded.changes} stale UPDATE/CALL sync items after 5 failed attempts`);
      this.updatePendingCount();
    }

    // Auto-discard stale UPDATE/CALL items older than 1 hour — the cloud state has moved on
    // (e.g., a "call" action from an hour ago is meaningless now)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const staleDiscarded = this.db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND operation != 'INSERT' AND created_at < ?"
    ).run(oneHourAgo);
    if (staleDiscarded.changes > 0) {
      console.warn(`[sync] Auto-discarded ${staleDiscarded.changes} stale sync items older than 1 hour`);
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

  // Returns { status: 0 } on success, { status: httpCode } on failure
  // 401 is returned separately so the caller can refresh token and retry
  private async replayMutation(item: any, authToken: string): Promise<{ status: number }> {
    const payload = JSON.parse(item.payload);
    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    };

    const baseUrl = `${this.supabaseUrl}/rest/v1/${item.table_name}`;

    let res: Response;
    switch (item.operation) {
      case 'INSERT': {
        res = await fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok || res.status === 409) return { status: 0 };
        if (res.status === 401 || res.status === 403) return { status: 401 };
        throw new Error(`INSERT failed: ${res.status}`);
      }

      case 'UPDATE':
      case 'CALL': {
        const patchHeaders = { ...headers, Prefer: 'return=representation' };
        res = await fetch(`${baseUrl}?id=eq.${item.record_id}`, {
          method: 'PATCH',
          headers: patchHeaders,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401 || res.status === 403) return { status: 401 };
        if (res.ok) {
          // Check if Supabase actually updated any rows (RLS or status conflict = empty array)
          const body = await res.json().catch(() => []);
          if (Array.isArray(body) && body.length === 0) {
            console.warn(`[sync:replay] PATCH returned 0 rows for ${item.operation} on ${item.record_id} — row was likely changed/deleted remotely`);
            // Still mark as synced to avoid infinite retries on a conflict
            return { status: 0 };
          }
          return { status: 0 };
        }
        if (res.status === 409) return { status: 0 };
        throw new Error(`UPDATE failed: ${res.status}`);
      }

      default:
        throw new Error(`Unknown operation: ${item.operation}`);
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

    // Get a verified-fresh token (will refresh if expired)
    const freshToken = await this.ensureFreshToken();
    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${freshToken}`,
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
          // Token expired — force refresh (bypass cache) and retry once
          console.log('[sync:pullLatest] Token expired, forcing refresh...');
          this.cachedAccessToken = null;
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            headers.Authorization = `Bearer ${newToken}`;
            console.log('[sync:pullLatest] Token refreshed, retrying...');
            activeTickets = await fetchTickets(headers, activeUrl);
          }
          // If still null, try anon key as last resort (read-only but better than nothing)
          if (activeTickets === null) {
            console.log('[sync:pullLatest] Trying anon key as fallback...');
            const anonHeaders = { apikey: this.supabaseKey, Authorization: `Bearer ${this.supabaseKey}` };
            activeTickets = await fetchTickets(anonHeaders, activeUrl);
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

        // ── Reconcile: mark local "active" tickets as cancelled if cloud says they're gone ──
        // If a ticket is waiting/called/serving in SQLite but NOT in the cloud active set,
        // it was resolved elsewhere (served, cancelled, auto-resolved). Update SQLite to match.
        if (activeTickets !== null) {
          const cloudActiveIds = new Set(activeTickets.map((t: any) => t.id));
          const localActive = this.db.prepare(
            "SELECT id, ticket_number, status FROM tickets WHERE office_id = ? AND status IN ('waiting','called','serving')"
          ).all(officeId) as any[];

          for (const local of localActive) {
            if (cloudActiveIds.has(local.id)) continue; // still active in cloud — fine
            if (locallyModifiedIds.has(local.id)) continue; // we have a pending local change — don't overwrite

            // This ticket is active locally but gone from cloud — check history pull
            const inHistory = (histTickets ?? []).find((t: any) => t.id === local.id);
            if (inHistory) {
              // Cloud has it as served/cancelled — adopt that status
              console.log(`[sync:reconcile] ${local.ticket_number}: local=${local.status} → cloud=${inHistory.status}`);
            } else {
              // Not in cloud at all (auto-resolved or deleted) — mark as cancelled locally
              console.log(`[sync:reconcile] ${local.ticket_number}: local=${local.status} → cancelled (not in cloud)`);
              this.db.prepare(
                "UPDATE tickets SET status = 'cancelled', completed_at = ? WHERE id = ?"
              ).run(new Date().toISOString(), local.id);
            }
          }
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

  // ── Commercial-grade auto-resolve: call the DB function that cleans up stale tickets ──
  private async triggerAutoResolve() {
    try {
      const token = await this.ensureFreshToken();
      const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/auto_resolve_tickets`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const result = await res.json();
        const total = (result.requeued_called ?? 0) + (result.noshow_called ?? 0) +
          (result.cancelled_waiting ?? 0) + (result.completed_serving ?? 0) +
          (result.cancelled_yesterday ?? 0) + (result.completed_yesterday ?? 0);
        if (total > 0) {
          console.log(`[sync:autoResolve] Resolved ${total} stale tickets:`, result);
          // Pull fresh data since tickets changed
          await this.pullLatest();
        }
      }
    } catch (err: any) {
      // Non-critical — cron on Supabase handles this too
      console.log('[sync:autoResolve] Skipped:', err?.message ?? err);
    }
  }
}
