import Database from 'better-sqlite3';
import { safeStorage } from 'electron';
import { CONFIG } from './config';
import { logTicketEvent } from './db';

type StatusCallback = (status: 'online' | 'offline' | 'syncing' | 'connecting') => void;
type ProgressCallback = (pendingCount: number) => void;
type AuthErrorCallback = () => void;
type DataPulledCallback = () => void;
type TicketErrorCallback = (error: { message: string; ticketNumber?: string; type: string }) => void;

export class SyncEngine {
  private db: Database.Database;
  private supabaseUrl: string;
  private supabaseKey: string;
  private onStatus: StatusCallback;
  private onProgress: ProgressCallback;
  private onAuthError: AuthErrorCallback;
  private onDataPulled: DataPulledCallback;
  private onTicketError: TicketErrorCallback;
  private authErrorSuppressedUntil = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private pullInterval: ReturnType<typeof setInterval> | null = null;

  public isOnline = false;
  public lastSyncAt: string | null = null;
  public pendingCount = 0;

  // ── Connection quality tracking ────────────────────────────────────
  // Distinguishes "fully offline" from "flaky connection" (high latency/timeouts).
  // Flaky connections are the most dangerous: sync starts but may time out halfway.
  private healthLatencyMs = 0;
  private consecutiveSlowChecks = 0;
  private static SLOW_THRESHOLD_MS = 3000; // health check taking >3s = slow
  private static FLAKY_THRESHOLD = 3;      // 3 consecutive slow checks = flaky
  public connectionQuality: 'good' | 'slow' | 'flaky' | 'offline' = 'offline';

  // ── Change detection for pull ─────────────────────────────────────
  // Only notify displays when ticket data actually changed
  private lastPullHash = '';

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
    onTicketError: TicketErrorCallback = () => {},
  ) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onAuthError = onAuthError;
    this.onDataPulled = onDataPulled;
    this.onTicketError = onTicketError;
  }

  private realtimeWs: WebSocket | null = null;
  private realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private autoResolveInterval: ReturnType<typeof setInterval> | null = null;

  // ── Rapid retry tracking for pushImmediate ──
  private rapidRetryInFlight = new Set<string>();
  private static RAPID_RETRY_DELAYS = [2000, 5000, 15000]; // 2s, 5s, 15s

  // ── Circuit breaker ──────────────────────────────────────────────
  // Prevents infinite retry loops when the cloud is unreachable or broken.
  // After CIRCUIT_BREAKER_THRESHOLD consecutive push failures, the circuit
  // opens and sync pauses for CIRCUIT_BREAKER_COOLDOWN_MS. The operator
  // is notified via onTicketError so they can investigate.
  private consecutivePushFailures = 0;
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private static CIRCUIT_BREAKER_THRESHOLD = 5;
  private static CIRCUIT_BREAKER_COOLDOWN_MS = 60_000; // 1 minute cooldown

  private tripCircuitBreaker(lastError: string) {
    if (this.circuitOpen) return;
    this.circuitOpen = true;
    this.circuitOpenedAt = Date.now();
    console.error(`[sync:circuit-breaker] OPEN after ${this.consecutivePushFailures} consecutive failures. Pausing sync for ${SyncEngine.CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
    this.onTicketError({
      message: `Sync paused: ${this.consecutivePushFailures} consecutive failures. Last error: ${lastError}. Will auto-retry in ${SyncEngine.CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s.`,
      type: 'circuit_breaker_open',
    });
  }

  private checkCircuitBreaker(): boolean {
    if (!this.circuitOpen) return true; // circuit closed — allow sync
    const elapsed = Date.now() - this.circuitOpenedAt;
    if (elapsed >= SyncEngine.CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Half-open: allow one attempt to see if the service recovered
      console.log('[sync:circuit-breaker] Cooldown elapsed — half-open, attempting sync...');
      this.circuitOpen = false;
      this.consecutivePushFailures = 0;
      return true;
    }
    return false; // circuit still open — block sync
  }

  private recordPushSuccess() {
    if (this.consecutivePushFailures > 0) {
      console.log(`[sync:circuit-breaker] Push succeeded — resetting failure count (was ${this.consecutivePushFailures})`);
    }
    this.consecutivePushFailures = 0;
    this.circuitOpen = false;
  }

  private recordPushFailure(error: string) {
    this.consecutivePushFailures++;
    if (this.consecutivePushFailures >= SyncEngine.CIRCUIT_BREAKER_THRESHOLD) {
      this.tripCircuitBreaker(error);
    }
  }

  start() {
    // ── STARTUP RECOVERY: Reset sync items that were mid-flight when app crashed/restarted ──
    // Items with attempts > 0 but no synced_at may have been interrupted mid-push.
    // Reset their next_retry_at so they're immediately eligible for the next sync cycle.
    const recovered = this.db.prepare(`
      UPDATE sync_queue
      SET next_retry_at = NULL
      WHERE synced_at IS NULL AND next_retry_at IS NOT NULL
    `).run();
    if (recovered.changes > 0) {
      console.log(`[sync:startup] Recovered ${recovered.changes} sync item(s) stuck from previous session`);
    }
    this.updatePendingCount();

    // Check connectivity
    this.healthInterval = setInterval(() => this.checkHealth(), CONFIG.HEALTH_CHECK_INTERVAL);
    this.checkHealth();

    // ── STARTUP: Force token refresh immediately ──
    this.refreshOnStartup();

    // Try to sync pending items
    this.interval = setInterval(() => this.syncNow(), CONFIG.SYNC_PUSH_INTERVAL);

    // Pull cloud data when online (Realtime handles instant updates, this is fallback)
    this.pullInterval = setInterval(() => {
      if (this.isOnline) this.pullLatest();
    }, CONFIG.SYNC_PULL_INTERVAL);

    // Auto-resolve stale tickets + background reconciliation
    this.autoResolveInterval = setInterval(() => {
      if (this.isOnline) {
        this.triggerAutoResolve();
        this.reconcileLPrefixTickets();
      }
      this.recoverStuckItems();
      this.revertStaleCalled();
    }, CONFIG.AUTO_RESOLVE_INTERVAL);
  }

  private async refreshOnStartup() {
    try {
      // Wait a moment for connectivity check to complete
      await new Promise((r) => setTimeout(r, 2000));
      if (!this.isOnline) return;

      const session = this.getSessionFromDB();
      if (!session?.refresh_token) return;

      console.log('[sync:startup] Proactively refreshing access token...');
      this.cachedAccessToken = null; // force fresh
      const token = await this.refreshAccessToken();
      if (token) {
        console.log('[sync:startup] ✓ Token refreshed — station is ready');
        // Immediately sync pending items with fresh token
        this.syncNow();
        this.pullLatest();
      } else {
        console.warn('[sync:startup] Token refresh failed — user may need to re-login');
      }
    } catch (err: any) {
      console.warn('[sync:startup] Startup refresh error:', err?.message);
    }
  }

  /**
   * Graceful shutdown: attempt one final push of pending items before stopping.
   * Called from app 'before-quit' — gives a short window to flush critical changes.
   */
  async stopGraceful(timeoutMs = 5000): Promise<void> {
    // Clear all intervals first to prevent new work
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.pullInterval) clearInterval(this.pullInterval);
    if (this.autoResolveInterval) clearInterval(this.autoResolveInterval);
    this.disconnectRealtime();

    if (!this.isOnline) {
      console.log('[sync:shutdown] Offline — skipping flush');
      return;
    }

    const pending = this.db.prepare(
      "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    if (!pending?.c) {
      console.log('[sync:shutdown] No pending items — clean shutdown');
      return;
    }

    console.log(`[sync:shutdown] Flushing ${pending.c} pending item(s) before quit...`);
    try {
      // Race: sync vs timeout — whichever finishes first
      await Promise.race([
        this.syncNow(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      const remaining = this.db.prepare(
        "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL"
      ).get() as any;
      if (remaining?.c > 0) {
        console.warn(`[sync:shutdown] ${remaining.c} item(s) still pending — will retry on next launch`);
      } else {
        console.log('[sync:shutdown] All items flushed successfully');
      }
    } catch (err: any) {
      console.warn('[sync:shutdown] Flush failed:', err?.message);
    }
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

  private async connectRealtime() {
    if (this.realtimeWs) return; // already connected

    const sessionRow = this.db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.office_ids?.length) return;

    const wsUrl = this.supabaseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    // Use a fresh access token for RLS-aware realtime
    const token = await this.ensureFreshToken();

    try {
      const ws = new WebSocket(
        `${wsUrl}/realtime/v1/websocket?apikey=${this.supabaseKey}&vsn=1.0.0`
      );

      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      // Debounce pull calls — multiple changes within 500ms trigger only one pull
      let pullDebounce: ReturnType<typeof setTimeout> | null = null;

      ws.onopen = () => {
        console.log('[realtime] ✓ Connected to Supabase Realtime');
        // Authenticate with access token for RLS
        ws.send(JSON.stringify({
          topic: 'realtime:auth',
          event: 'access_token',
          payload: { access_token: token },
          ref: 'auth',
        }));

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
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' }));
          } else {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          // Supabase Realtime v2 wraps postgres changes in payload.data
          const isChange =
            msg.event === 'postgres_changes' ||
            msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE' ||
            msg.payload?.data?.type === 'INSERT' || msg.payload?.data?.type === 'UPDATE' || msg.payload?.data?.type === 'DELETE';

          if (isChange) {
            console.log(`[realtime] Ticket change detected — pulling immediately`);
            // Debounce: batch rapid-fire changes into one pull
            if (pullDebounce) clearTimeout(pullDebounce);
            pullDebounce = setTimeout(() => {
              this.pullLatest();
              pullDebounce = null;
            }, 300);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        console.log('[realtime] Disconnected, will retry in 5s');
        if (heartbeatTimer) clearInterval(heartbeatTimer);
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
    // Proactively refresh token every 30 minutes (JWT expires at 60 min by default)
    // Aggressive refresh prevents token expiry from ever blocking sync
    if (this.isOnline && Date.now() - this.lastTokenRefreshAt > 30 * 60 * 1000) {
      await this.ensureFreshToken();
    }

    try {
      const healthStart = Date.now();
      const res = await fetch(`${this.supabaseUrl}/rest/v1/offices?select=id&limit=1`, {
        method: 'GET',
        headers: { apikey: this.supabaseKey, Authorization: `Bearer ${this.supabaseKey}` },
        signal: AbortSignal.timeout(5000),
      });
      this.healthLatencyMs = Date.now() - healthStart;

      const wasOffline = !this.isOnline;
      this.isOnline = res.ok;

      // ── Connection quality detection ──
      if (this.isOnline) {
        if (this.healthLatencyMs > SyncEngine.SLOW_THRESHOLD_MS) {
          this.consecutiveSlowChecks++;
          if (this.consecutiveSlowChecks >= SyncEngine.FLAKY_THRESHOLD) {
            if (this.connectionQuality !== 'flaky') {
              console.warn(`[sync:health] Connection is FLAKY — ${this.consecutiveSlowChecks} consecutive slow responses (${this.healthLatencyMs}ms)`);
              this.onTicketError({
                message: `Slow connection detected (${this.healthLatencyMs}ms latency). Sync may be delayed.`,
                type: 'connection_flaky',
              });
            }
            this.connectionQuality = 'flaky';
          } else {
            this.connectionQuality = 'slow';
          }
        } else {
          if (this.connectionQuality === 'flaky' && this.consecutiveSlowChecks > 0) {
            console.log(`[sync:health] Connection recovered — latency back to ${this.healthLatencyMs}ms`);
          }
          this.consecutiveSlowChecks = 0;
          this.connectionQuality = 'good';
        }
      } else {
        this.consecutiveSlowChecks = 0;
        this.connectionQuality = 'offline';
      }

      if (wasOffline && this.isOnline) {
        // CRITICAL: Push local changes first, then pull, then notify online
        this.onStatus('syncing');
        await this.syncNow();   // Push offline changes to cloud
        await this.pullLatest(); // Pull cloud state into SQLite (merges, doesn't overwrite)
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
      this.connectionQuality = 'offline';
      this.consecutiveSlowChecks = 0;
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

  private lastQueueWarningAt = 0;
  private static QUEUE_WARNING_THRESHOLD = 50;
  private static QUEUE_WARNING_COOLDOWN_MS = 300_000; // warn at most every 5 min

  public updatePendingCount() {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    this.pendingCount = row?.count ?? 0;
    this.onProgress(this.pendingCount);

    // ── Sync queue size warning ──
    // Alert operator if pending items pile up beyond threshold
    if (this.pendingCount >= SyncEngine.QUEUE_WARNING_THRESHOLD &&
        Date.now() - this.lastQueueWarningAt > SyncEngine.QUEUE_WARNING_COOLDOWN_MS) {
      this.lastQueueWarningAt = Date.now();
      console.warn(`[sync:queue] WARNING: ${this.pendingCount} pending sync items — check connection`);
      this.onTicketError({
        message: `${this.pendingCount} changes waiting to sync. Check your internet connection.`,
        type: 'sync_queue_warning',
      });
    }
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
  // Falls back to silent re-auth with stored encrypted credentials if refresh_token is dead
  private async refreshAccessToken(): Promise<string | null> {
    const session = this.getSessionFromDB();
    if (!session?.refresh_token) {
      console.warn('[sync:token] No refresh_token — attempting silent re-auth');
      return this.silentReAuth();
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
        // If refresh_token itself is expired/revoked — try silent re-auth
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          console.log('[sync:token] Refresh token is dead — attempting silent re-auth with stored credentials');
          const reAuthResult = await this.silentReAuth();
          if (reAuthResult) return reAuthResult;

          this.consecutiveRefreshFailures++;
          if (this.consecutiveRefreshFailures >= 5 && Date.now() > this.authErrorSuppressedUntil) {
            console.error('[sync:token] All auth methods exhausted — prompting re-login');
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

  /**
   * Silent re-authentication: uses OS-encrypted stored credentials to get
   * a brand new Supabase session when the refresh token is dead.
   * Zero user intervention — the station heals itself.
   */
  private async silentReAuth(): Promise<string | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[sync:reAuth] OS encryption not available — cannot decrypt stored credentials');
        return null;
      }

      const credRow = this.db.prepare("SELECT value FROM session WHERE key = 'auth_cred'").get() as any;
      if (!credRow) {
        console.warn('[sync:reAuth] No stored credentials found — user must sign in manually');
        return null;
      }

      const cred = JSON.parse(credRow.value);
      if (!cred?.email || !cred?.enc) return null;

      // Decrypt password using OS credential store (Windows DPAPI / macOS Keychain)
      const password = safeStorage.decryptString(Buffer.from(cred.enc, 'base64'));

      console.log(`[sync:reAuth] Attempting silent re-auth for ${cred.email}...`);
      const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: cred.email, password }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[sync:reAuth] Re-auth failed (${res.status}): ${body.slice(0, 200)}`);
        // If password was changed, credentials are stale — clear them
        if (res.status === 400 || res.status === 401) {
          this.db.prepare("DELETE FROM session WHERE key = 'auth_cred'").run();
          console.warn('[sync:reAuth] Stored credentials invalidated — user must sign in manually');
        }
        return null;
      }

      const data = await res.json();
      if (!data.access_token || !data.refresh_token) return null;

      // Update session with fresh tokens
      const session = this.getSessionFromDB();
      const updated = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
      this.db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('current', ?)").run(JSON.stringify(updated));

      // Update in-memory cache
      this.cachedAccessToken = data.access_token;
      this.lastTokenRefreshAt = Date.now();
      this.consecutiveRefreshFailures = 0;

      console.log('[sync:reAuth] ✓ Silent re-auth succeeded — station is back online');

      // Auto-retry all stuck AUTH_EXPIRED items
      this.db.prepare(
        "UPDATE sync_queue SET attempts = 0, last_error = NULL, next_retry_at = NULL WHERE synced_at IS NULL AND last_error LIKE '%AUTH_EXPIRED%'"
      ).run();
      this.updatePendingCount();

      return data.access_token;
    } catch (err: any) {
      console.warn('[sync:reAuth] Silent re-auth error:', err?.message ?? err);
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
   * On failure, schedules rapid retries (2s, 5s, 15s) before falling back to syncNow().
   */
  async pushImmediate(syncQueueId: string, _retryAttempt = 0) {
    if (!this.isOnline) return;

    const item = this.db.prepare(
      "SELECT * FROM sync_queue WHERE id = ? AND synced_at IS NULL"
    ).get(syncQueueId) as any;
    if (!item) {
      this.rapidRetryInFlight.delete(syncQueueId);
      return;
    }

    try {
      const authToken = await this.ensureFreshToken();
      const result = await this.replayMutation(item, authToken);

      if (result.status === 0) {
        this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
          .run(new Date().toISOString(), item.id);
        this.updatePendingCount();
        this.rapidRetryInFlight.delete(syncQueueId);
        console.log(`[sync:pushImmediate] ✓ Pushed ${item.operation} on ${item.table_name}/${item.record_id}`);

        // ── Gap 2: Rewrite L- prefix after successful INSERT push ──
        if (item.operation === 'INSERT' && item.table_name === 'tickets') {
          this.rewriteOfflineTicket(item.record_id, item.payload);
        }
        return;
      }

      if (result.status === 401) {
        // Token expired — force refresh and retry once
        this.cachedAccessToken = null;
        const newToken = await this.refreshAccessToken();
        if (newToken) {
          const retry = await this.replayMutation(item, newToken);
          if (retry.status === 0) {
            this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
              .run(new Date().toISOString(), item.id);
            this.updatePendingCount();
            this.rapidRetryInFlight.delete(syncQueueId);
            console.log(`[sync:pushImmediate] ✓ Pushed after token refresh`);
            if (item.operation === 'INSERT' && item.table_name === 'tickets') {
              this.rewriteOfflineTicket(item.record_id, item.payload);
            }
            return;
          }
        }
      }

      // Non-auth failure — schedule rapid retry
      this.scheduleRapidRetry(syncQueueId, _retryAttempt);
    } catch (err: any) {
      console.log(`[sync:pushImmediate] Attempt ${_retryAttempt + 1} failed: ${err?.message ?? err}`);
      this.scheduleRapidRetry(syncQueueId, _retryAttempt);
    }
  }

  /** Schedule rapid retry: 2s → 5s → 15s → give up (syncNow takes over) */
  private scheduleRapidRetry(syncQueueId: string, currentAttempt: number) {
    if (currentAttempt >= SyncEngine.RAPID_RETRY_DELAYS.length) {
      this.rapidRetryInFlight.delete(syncQueueId);
      console.log(`[sync:pushImmediate] Rapid retries exhausted for ${syncQueueId} — syncNow will handle it`);
      return;
    }
    if (this.rapidRetryInFlight.has(syncQueueId) && currentAttempt > 0) return; // already scheduled
    this.rapidRetryInFlight.add(syncQueueId);

    const delay = SyncEngine.RAPID_RETRY_DELAYS[currentAttempt];
    console.log(`[sync:pushImmediate] Scheduling retry ${currentAttempt + 1}/3 in ${delay}ms`);
    setTimeout(() => this.pushImmediate(syncQueueId, currentAttempt + 1), delay);
  }

  /**
   * After a locally-created ticket is successfully pushed to cloud,
   * rewrite its L-{DEPT}-{NNN} number to a proper {DEPT}-{NNN} number
   * and clear the is_offline flag. Updates both SQLite and Supabase.
   */
  private async rewriteOfflineTicket(recordId: string, rawPayload?: string) {
    try {
      const ticket = this.db.prepare(
        "SELECT id, ticket_number, office_id, department_id, is_offline FROM tickets WHERE id = ?"
      ).get(recordId) as any;

      if (!ticket || !ticket.is_offline || !ticket.ticket_number?.startsWith('L-')) return;

      // Parse the sync payload for daily_sequence (already pushed to cloud)
      let dailySequence: number | null = null;
      if (rawPayload) {
        try {
          const payload = JSON.parse(rawPayload);
          dailySequence = payload.daily_sequence ?? null;
        } catch { /* ignore */ }
      }

      // Get department code
      const dept = this.db.prepare("SELECT code FROM departments WHERE id = ?").get(ticket.department_id) as any;
      const deptCode = dept?.code ?? 'Q';

      // Determine the proper ticket number
      // Strategy: query cloud for the highest ticket number for this dept today
      // to avoid duplicates with web-created tickets
      const token = await this.ensureFreshToken();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      let properSequence = dailySequence;

      // Query cloud for max sequence to avoid number collisions with web/mobile tickets
      try {
        const maxRes = await fetch(
          `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${ticket.office_id}&department_id=eq.${ticket.department_id}&created_at=gte.${todayStart.toISOString()}&ticket_number=not.like.L-%25&select=daily_sequence&order=daily_sequence.desc&limit=1`,
          {
            headers: { apikey: this.supabaseKey, Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (maxRes.ok) {
          const rows = await maxRes.json();
          const cloudMax = rows[0]?.daily_sequence ?? 0;
          // Use whichever is higher: cloud max + 1, or our daily_sequence
          if (properSequence === null || cloudMax >= properSequence) {
            properSequence = cloudMax + 1;
          }
        }
      } catch { /* fallback to dailySequence from payload */ }

      if (properSequence === null) properSequence = 1;

      const properNumber = `${deptCode}-${String(properSequence).padStart(3, '0')}`;

      // Update local SQLite
      this.db.prepare("UPDATE tickets SET ticket_number = ?, is_offline = 0 WHERE id = ?")
        .run(properNumber, recordId);

      // Push UPDATE to cloud
      await fetch(`${this.supabaseUrl}/rest/v1/tickets?id=eq.${recordId}`, {
        method: 'PATCH',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ ticket_number: properNumber }),
        signal: AbortSignal.timeout(5000),
      });

      console.log(`[sync:rewrite] ✓ ${ticket.ticket_number} → ${properNumber} (is_offline cleared)`);
      this.onDataPulled(); // refresh UI with proper number
    } catch (err: any) {
      console.warn(`[sync:rewrite] Failed to rewrite ticket ${recordId}: ${err?.message}`);
      // Non-critical — ticket still works with L- prefix, just cosmetic
    }
  }

  async syncNow() {
    if (!this.isOnline) return;
    if (!this.checkCircuitBreaker()) return; // circuit breaker open — skip

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
                if (item.operation === 'INSERT' && item.table_name === 'tickets') {
                  this.rewriteOfflineTicket(item.record_id, item.payload);
                }
                continue;
              }
            }
            // Refresh failed or retry still 401 — auto-discard non-INSERT items (they're stale anyway)
            // Only INSERT items (new ticket creation) are worth keeping for retry after re-login
            const authFailPending = this.db.prepare(
              "SELECT id, operation FROM sync_queue WHERE synced_at IS NULL"
            ).all() as any[];
            let authDiscardCount = 0;
            for (const p of authFailPending) {
              if (p.operation !== 'INSERT') {
                this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(p.id);
                authDiscardCount++;
              } else {
                this.db.prepare(
                  "UPDATE sync_queue SET last_error = ? WHERE id = ?"
                ).run('AUTH_EXPIRED: re-login required', p.id);
              }
            }
            if (authDiscardCount > 0) {
              console.warn(`[sync] Auth expired — auto-discarded ${authDiscardCount} stale UPDATE/CALL items`);
            }
            this.updatePendingCount();

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
        this.recordPushSuccess();

        // Rewrite L- prefix after successful INSERT push
        if (item.operation === 'INSERT' && item.table_name === 'tickets') {
          this.rewriteOfflineTicket(item.record_id, item.payload);
        }
      } catch (err: any) {
        // Non-auth error: exponential backoff
        const newAttempts = (item.attempts ?? 0) + 1;
        const delayMs = Math.min(15000 * Math.pow(2, newAttempts - 1), 300000);
        const nextRetry = new Date(Date.now() + delayMs).toISOString();
        this.db.prepare(
          "UPDATE sync_queue SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
        ).run(newAttempts, err.message ?? 'Unknown error', nextRetry, item.id);

        // Circuit breaker: track consecutive failures
        this.recordPushFailure(err.message ?? 'Unknown error');
        if (this.circuitOpen) break; // circuit tripped — stop processing

        // Notify UI on 3rd failure so staff knows something is stuck
        if (newAttempts === 3 && item.table_name === 'tickets') {
          const payload = JSON.parse(item.payload || '{}');
          this.onTicketError({
            message: `Sync failed for ticket ${payload.ticket_number ?? item.record_id}: ${err.message ?? 'Unknown error'}`,
            ticketNumber: payload.ticket_number,
            type: 'sync_failed',
          });
        }
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

    // Auto-discard UPDATE/CALL items that failed 3+ times — but NEVER discard INSERTs
    // A customer's ticket creation must never be silently lost
    const discarded = this.db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 3 AND operation != 'INSERT'"
    ).run();
    if (discarded.changes > 0) {
      console.warn(`[sync] Auto-discarded ${discarded.changes} stale UPDATE/CALL sync items after 3 failed attempts`);
      this.updatePendingCount();
    }

    // Auto-discard sync items for tickets that are no longer active locally
    // (e.g., ticket was cancelled/resolved — no point pushing a stale "call" action)
    const orphanDiscarded = this.db.prepare(`
      DELETE FROM sync_queue WHERE synced_at IS NULL AND table_name = 'tickets' AND operation != 'INSERT'
      AND record_id NOT IN (
        SELECT id FROM tickets WHERE status IN ('waiting', 'called', 'serving')
      )
    `).run();
    if (orphanDiscarded.changes > 0) {
      console.warn(`[sync] Auto-discarded ${orphanDiscarded.changes} sync items for resolved/cancelled tickets`);
      this.updatePendingCount();
    }

    // Auto-discard stale UPDATE/CALL items older than 4 hours — the cloud state has moved on
    // (e.g., a "call" action from hours ago is meaningless now)
    // Extended from 1h to 4h to survive extended outages
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const staleDiscarded = this.db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND operation != 'INSERT' AND created_at < ?"
    ).run(fourHoursAgo);
    if (staleDiscarded.changes > 0) {
      console.warn(`[sync] Auto-discarded ${staleDiscarded.changes} stale sync items older than 4 hours`);
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

      // Pull offices, departments, services, desks, holidays in parallel
      const [officesRes, deptsRes, svcsRes, desksRes, holidaysRes] = await Promise.all([
        fetch(`${this.supabaseUrl}/rest/v1/offices?or=(${officeFilter})&select=id,name,address,organization_id,settings,operating_hours,timezone`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/departments?or=(${officeInFilter})&select=id,name,code,office_id`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/services?select=id,name,department_id,estimated_service_time`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/desks?or=(${officeInFilter})&select=id,name,department_id,office_id,is_active,current_staff_id`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/office_holidays?or=(${officeInFilter})&select=id,office_id,holiday_date,name,is_full_day,open_time,close_time`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
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

      // Sync holidays
      if (holidaysRes && holidaysRes.ok) {
        try {
          const holidays = await holidaysRes.json();
          // Clear and replace — holidays are small and infrequent
          this.db.prepare(`DELETE FROM office_holidays WHERE office_id IN (${officeIds.map(() => '?').join(',')})`).run(...officeIds);
          const hStmt = this.db.prepare(`INSERT OR REPLACE INTO office_holidays (id, office_id, holiday_date, name, is_full_day, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          for (const h of holidays) {
            hStmt.run(h.id, h.office_id, h.holiday_date, h.name, h.is_full_day ? 1 : 0, h.open_time ?? null, h.close_time ?? null);
          }
        } catch { /* table may not exist on first run */ }
      }

      const upsert = this.db.prepare(`
        INSERT OR REPLACE INTO tickets
        (id, ticket_number, office_id, department_id, service_id, desk_id, status, priority,
         customer_data, created_at, called_at, called_by_staff_id, serving_started_at,
         completed_at, cancelled_at, parked_at, recall_count, notes, is_remote, appointment_id, source, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // IDs of locally-modified tickets — protect ALL unsynced items regardless of age.
      // Previously used a 5-minute window which caused race conditions:
      //   1. Kiosk creates ticket (INSERT in sync_queue)
      //   2. pullLatest runs before pushImmediate completes
      //   3. Ticket not in cloud yet → reconciliation cancels it
      // Fix: protect ANY ticket with a pending sync item (INSERT/UPDATE/CALL).
      // For UPDATE/CALL, also check a time window to avoid blocking stale updates.
      const fiveMinAgo = new Date(Date.now() - 300000).toISOString();
      const locallyModifiedIds = new Set(
        (this.db.prepare(
          "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'tickets' AND (operation = 'INSERT' OR created_at > ?)"
        ).all(fiveMinAgo) as any[]).map((r: any) => r.record_id)
      );

      // Status progression rank — higher = more advanced in the lifecycle
      // A cloud pull should NEVER downgrade a local ticket to an earlier status
      const statusRank: Record<string, number> = {
        waiting: 0, called: 1, serving: 2, served: 3, no_show: 3, cancelled: 3, transferred: 3,
      };

      const checkPending = this.db.prepare(
        "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND record_id = ? AND table_name = 'tickets'"
      );
      const getLocalTicket = this.db.prepare(
        "SELECT status, desk_id, called_by_staff_id, called_at, serving_started_at FROM tickets WHERE id = ?"
      );

      const upsertBatch = this.db.transaction((rows: any[]) => {
        for (const t of rows) {
          // Check at upsert time (not start of pull) to avoid race with call-next
          const pending = checkPending.get(t.id) as any;
          if (pending?.c > 0) continue; // has pending sync — don't overwrite local changes

          // Never downgrade status (e.g., don't overwrite local "called" with cloud "waiting")
          // EXCEPTION: if the ticket was auto-cancelled locally (by reconciliation) but the cloud
          // still has it as active, the cloud should win — the local cancellation was a mistake.
          // We detect this by checking: local is "cancelled", cloud is active, AND there is no
          // pending sync item for this ticket (meaning the cancellation was never pushed to cloud).
          const local = getLocalTicket.get(t.id) as any;
          if (local) {
            const localRank = statusRank[local.status] ?? 0;
            const cloudRank = statusRank[t.status] ?? 0;
            if (cloudRank < localRank) {
              // Allow cloud to override local "cancelled" when the cancellation was never pushed
              const isLocalAutoCancel = local.status === 'cancelled' && ['waiting', 'called', 'serving'].includes(t.status);
              const hasPendingSync = (checkPending.get(t.id) as any)?.c > 0;
              if (isLocalAutoCancel && !hasPendingSync) {
                console.log(`[sync:pull] Cloud overrides local auto-cancel for ${t.ticket_number}: local=cancelled → cloud=${t.status}`);
                logTicketEvent(t.id, 'restored_from_cloud', {
                  ticketNumber: t.ticket_number,
                  fromStatus: 'cancelled',
                  toStatus: t.status,
                  source: 'sync_pull',
                  details: { reason: 'cloud_still_active_local_auto_cancelled' },
                });
              } else {
                console.log(`[sync:pull] Skipping downgrade for ${t.ticket_number}: local=${local.status}(${localRank}) > cloud=${t.status}(${cloudRank})`);
                continue;
              }
            }

            // PROTECT desk assignment: if the local ticket is actively called/serving
            // with a desk assigned, don't let cloud overwrite desk_id/staff_id.
            // This prevents recover_stuck_tickets() cron or stale cloud data from
            // orphaning a ticket that this station is actively working on.
            const localIsActive = ['called', 'serving'].includes(local.status);
            const cloudIsActive = ['called', 'serving'].includes(t.status);
            if (localIsActive && cloudIsActive && local.desk_id) {
              // Preserve local desk assignment — cloud may have stale or null desk_id
              t.desk_id = local.desk_id;
              t.called_by_staff_id = local.called_by_staff_id;
              t.called_at = local.called_at ?? t.called_at;
              t.serving_started_at = local.serving_started_at ?? t.serving_started_at;
              // Keep the more advanced status
              if (localRank > cloudRank) {
                t.status = local.status;
              }
            }
          }

          upsert.run(
            t.id, t.ticket_number, t.office_id, t.department_id, t.service_id,
            t.desk_id, t.status, t.priority ?? 0,
            typeof t.customer_data === 'string' ? t.customer_data : JSON.stringify(t.customer_data ?? {}),
            t.created_at, t.called_at, t.called_by_staff_id, t.serving_started_at,
            t.completed_at, t.cancelled_at, t.parked_at, t.recall_count ?? 0,
            t.notes, t.is_remote ? 1 : 0, t.appointment_id, t.source ?? 'walk_in',
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
            "SELECT id, ticket_number, status, is_offline FROM tickets WHERE office_id = ? AND status IN ('waiting','called','serving')"
          ).all(officeId) as any[];

          for (const local of localActive) {
            if (cloudActiveIds.has(local.id)) continue; // still active in cloud — fine
            if (locallyModifiedIds.has(local.id)) continue; // we have a pending local change — don't overwrite
            if (local.is_offline) continue; // offline-created ticket not yet synced — don't cancel it

            // Extra safety: never cancel tickets created less than 2 minutes ago
            // (covers the gap between INSERT and first successful push)
            const localTicket = this.db.prepare("SELECT created_at FROM tickets WHERE id = ?").get(local.id) as any;
            if (localTicket?.created_at) {
              const ageMs = Date.now() - new Date(localTicket.created_at).getTime();
              if (ageMs < 120_000) {
                console.log(`[sync:reconcile] Skipping ${local.ticket_number} — created ${Math.round(ageMs / 1000)}s ago, too recent to cancel`);
                continue;
              }
            }

            // This ticket is active locally but gone from cloud — check history pull
            const inHistory = (histTickets ?? []).find((t: any) => t.id === local.id);
            if (inHistory) {
              // Cloud has it as served/cancelled — adopt that status
              console.log(`[sync:reconcile] ${local.ticket_number}: local=${local.status} → cloud=${inHistory.status}`);
              logTicketEvent(local.id, 'reconcile_status_update', {
                ticketNumber: local.ticket_number,
                fromStatus: local.status,
                toStatus: inHistory.status,
                source: 'sync_reconcile',
                details: { reason: 'cloud_status_adopted' },
              });
              this.onTicketError({
                message: `${local.ticket_number} was ${inHistory.status} remotely`,
                ticketNumber: local.ticket_number,
                type: 'reconcile_status_change',
              });
            } else {
              // Not in cloud at all (auto-resolved or deleted) — mark as cancelled locally
              console.log(`[sync:reconcile] ${local.ticket_number}: local=${local.status} → cancelled (not in cloud)`);
              logTicketEvent(local.id, 'auto_cancelled', {
                ticketNumber: local.ticket_number,
                fromStatus: local.status,
                toStatus: 'cancelled',
                source: 'sync_reconcile',
                details: { reason: 'not_found_in_cloud', wasOffline: Boolean(local.is_offline) },
              });
              this.db.prepare(
                "UPDATE tickets SET status = 'cancelled', completed_at = ? WHERE id = ?"
              ).run(new Date().toISOString(), local.id);
              this.onTicketError({
                message: `${local.ticket_number} was removed — not found in cloud`,
                ticketNumber: local.ticket_number,
                type: 'auto_cancelled',
              });
            }
          }
        }

        // ── Clean up L- prefixed local tickets that have been synced to cloud ──
        // Only delete L- copies when the cloud ticket has the SAME ID (meaning the
        // offline ticket was successfully pushed and the cloud assigned a real number).
        // Never delete based on ticket_number alone — a new L-CS-003 is NOT a dupe of
        // yesterday's CS-003.
        const allPulled = [...(activeTickets ?? []), ...(histTickets ?? [])];
        const pulledIds = new Set(allPulled.map((t: any) => t.id));
        for (const t of allPulled) {
          if (!t.ticket_number || !t.id || t.ticket_number.startsWith('L-')) continue;
          // Only remove L- prefixed LOCAL copies that share the same record ID
          // (the sync engine reuses the UUID, so after push the cloud has the same id)
          const localL = this.db.prepare(
            "SELECT id, ticket_number FROM tickets WHERE id = ? AND ticket_number LIKE 'L-%'"
          ).get(t.id) as any;
          if (localL) {
            // Cloud now has this ticket with a real number — delete the L- local copy
            console.log(`[sync:cleanup] Removing local ${localL.ticket_number}, cloud has ${t.ticket_number}`);
            this.db.prepare("DELETE FROM tickets WHERE id = ? AND ticket_number LIKE 'L-%'").run(t.id);
          }
        }
      }

      // Only notify displays if ticket data actually changed
      // Build a lightweight hash of active ticket states
      try {
        const rows = this.db.prepare(
          "SELECT id, status, desk_id, called_at FROM tickets WHERE status IN ('waiting','called','serving') ORDER BY id"
        ).all() as any[];
        const hash = rows.map((r: any) => `${r.id}:${r.status}:${r.desk_id ?? ''}:${r.called_at ?? ''}`).join('|');
        if (hash !== this.lastPullHash) {
          this.lastPullHash = hash;
          this.onDataPulled();
        }
      } catch {
        // Fallback: always notify if hash check fails
        this.onDataPulled();
      }
    } catch (err: any) {
      console.error('[sync:pullLatest] Error:', err?.message ?? err);
    }
  }

  /**
   * L-prefix reconciliation: find any tickets still stuck with L- prefix
   * (rewrite failed after push) and attempt to fix them.
   * Runs every auto-resolve cycle (~60s) as a background cleanup.
   */
  private async reconcileLPrefixTickets() {
    try {
      const orphans = this.db.prepare(
        "SELECT id, ticket_number, office_id, department_id FROM tickets WHERE ticket_number LIKE 'L-%' AND is_offline = 0"
      ).all() as any[];
      if (orphans.length === 0) return;

      console.log(`[sync:reconcile] Found ${orphans.length} ticket(s) with L- prefix after sync — fixing...`);
      for (const ticket of orphans) {
        await this.rewriteOfflineTicket(ticket.id);
      }
    } catch (err: any) {
      console.warn('[sync:reconcile] L-prefix reconciliation error:', err?.message);
    }
  }

  /**
   * Recover stuck sync items: reset items that have been stuck for > 30 min
   * with retriable errors (network timeouts, 5xx). Caps at 10 total attempts.
   */
  private recoverStuckItems() {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recovered = this.db.prepare(`
      UPDATE sync_queue
      SET attempts = CASE WHEN attempts > 8 THEN 8 ELSE attempts END,
          next_retry_at = NULL
      WHERE synced_at IS NULL
        AND attempts >= 3 AND attempts < 10
        AND created_at < ?
        AND (last_error LIKE '%timeout%' OR last_error LIKE '%fetch%' OR last_error LIKE '%5___%' OR last_error LIKE '%network%')
    `).run(thirtyMinAgo);
    if (recovered.changes > 0) {
      console.log(`[sync:recover] Reset ${recovered.changes} stuck item(s) for retry`);
    }
  }

  /**
   * Revert stale "called" tickets back to "waiting" if no desk action within 30 minutes.
   * This handles the case where a ticket is called but the customer never shows up
   * and the operator forgets to mark it as no-show. Runs locally — no cloud dependency.
   */
  private revertStaleCalled() {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stale = this.db.prepare(`
      SELECT id, ticket_number, desk_id FROM tickets
      WHERE status = 'called' AND called_at IS NOT NULL AND called_at < ?
        AND serving_started_at IS NULL
    `).all(thirtyMinAgo) as any[];

    if (stale.length === 0) return;

    const now = new Date().toISOString();
    const revert = this.db.prepare(
      "UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL WHERE id = ? AND status = 'called'"
    );
    for (const t of stale) {
      revert.run(t.id);
      logTicketEvent(t.id, 'requeued', {
        ticketNumber: t.ticket_number,
        fromStatus: 'called',
        toStatus: 'waiting',
        source: 'auto_stale_revert',
        details: { reason: 'called_30min_no_action', previousDesk: t.desk_id },
      });

      // Queue sync so cloud also gets the revert
      const syncId = `${t.id}-stale-revert-${Date.now()}`;
      this.db.prepare(`
        INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
        VALUES (?, 'UPDATE', 'tickets', ?, ?, ?)
      `).run(syncId, t.id, JSON.stringify({ status: 'waiting', desk_id: null, called_at: null, called_by_staff_id: null }), now);
    }

    console.log(`[sync:staleCalled] Reverted ${stale.length} ticket(s) called 30+ min ago back to waiting`);
    this.onTicketError({
      message: `${stale.length} ticket(s) returned to queue — called 30+ min ago with no action`,
      type: 'stale_called_reverted',
    });
    this.onDataPulled(); // refresh UI
    this.updatePendingCount();
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
