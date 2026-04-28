import Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';
import { CONFIG } from './config';
import { logTicketEvent, setSyncNotifier, enqueueSync, deriveOrgIdForSyncItem } from './db';
import { logger } from './logger';
import { createQfError } from './error-codes';
import { normalizePhone } from '@qflo/shared';

type StatusCallback = (status: 'online' | 'offline' | 'syncing' | 'connecting') => void;
type ProgressCallback = (pendingCount: number) => void;
type AuthErrorCallback = () => void;
type DataPulledCallback = () => void;
type ConfigChangedCallback = () => void;
type TicketErrorCallback = (error: { message: string; ticketNumber?: string; type: string }) => void;
type TokenRefreshedCallback = (token: string, refreshToken: string) => void;
/** Returns { email, password } or null if no stored credentials */
type GetStoredCredsCallback = () => Promise<{ email: string; password: string } | null>;

export class SyncEngine {
  private db: Database.Database;
  private supabaseUrl: string;
  private supabaseKey: string;
  private onStatus: StatusCallback;
  private onProgress: ProgressCallback;
  private onAuthError: AuthErrorCallback;
  private onDataPulled: DataPulledCallback;
  private onConfigChanged: ConfigChangedCallback = () => {};
  private onTicketError: TicketErrorCallback;
  private lastConfigHash = '';
  private onTokenRefreshed: TokenRefreshedCallback;
  private getStoredCreds: GetStoredCredsCallback;
  private authErrorSuppressedUntil = 0;
  private firstRefreshFailureAt = 0;
  private silentReAuthInFlight = false;
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
    onTokenRefreshed: TokenRefreshedCallback = () => {},
    getStoredCreds: GetStoredCredsCallback = async () => null,
  ) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onAuthError = onAuthError;
    this.onDataPulled = onDataPulled;
    this.onTicketError = onTicketError;
    this.onTokenRefreshed = onTokenRefreshed;
    this.getStoredCreds = getStoredCreds;
  }

  public setConfigChangedCallback(cb: ConfigChangedCallback) {
    this.onConfigChanged = cb;
  }

  /** Force a fresh config pull — used after local admin edits to propagate immediately */
  public async refreshConfig() {
    this.lastConfigHash = ''; // force onConfigChanged to fire even if data matches
    await this.pullLatest();
  }

  private realtimeWs: WebSocket | null = null;
  private realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private autoResolveInterval: ReturnType<typeof setInterval> | null = null;
  private lastReconcileAt = 0;
  private static RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // ── Sync mode (cloud vs local_backup) ──
  // 'local_backup' Stations run entirely from SQLite; sync only runs as a
  // periodic safety-net upload (every BACKUP_SNAPSHOT_INTERVAL_MS) and
  // pullLatest / Realtime are disabled. 'cloud' is the default real-time
  // mode. Mode is per-Station, persisted in the session key-value table,
  // toggled live via applyModeChange() — no restart needed.
  private lastBackupAt = 0;
  private static BACKUP_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h
  private getMode(): 'cloud' | 'local_backup' {
    try {
      const row = this.db.prepare("SELECT value FROM session WHERE key = 'sync_mode'").get() as { value?: string } | undefined;
      return row?.value === 'local_backup' ? 'local_backup' : 'cloud';
    } catch { return 'cloud'; }
  }

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
    logger.error('sync.circuit-breaker', 'Circuit breaker OPEN — pausing sync', { consecutiveFailures: this.consecutivePushFailures, cooldownSeconds: SyncEngine.CIRCUIT_BREAKER_COOLDOWN_MS / 1000 });
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
      logger.info('sync.circuit-breaker', 'Cooldown elapsed — half-open, attempting sync...');
      this.circuitOpen = false;
      this.consecutivePushFailures = 0;
      return true;
    }
    return false; // circuit still open — block sync
  }

  private recordPushSuccess() {
    if (this.consecutivePushFailures > 0) {
      logger.info('sync.circuit-breaker', 'Push succeeded — resetting failure count', { previousFailures: this.consecutivePushFailures });
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
    // Idempotent: clear any pre-existing intervals before arming new
    // ones. start() is called both at app boot AND on every sign-in
    // (after session:clear stops the engine on sign-out). Without this
    // guard a stop→start cycle would leak a timer and double-tick.
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.pullInterval) clearInterval(this.pullInterval);
    if (this.autoResolveInterval) clearInterval(this.autoResolveInterval);

    // ── Register sync notifier so db.ts writers (logTicketEvent, etc.)
    // can trigger an immediate push on every enqueue instead of waiting
    // up to 10s for the batch interval. Prevents ticket_events and other
    // background mutations from sitting at "Attempts: 0" when the parent
    // operation already succeeded over pushImmediate.
    setSyncNotifier((syncId: string) => {
      try { void this.pushImmediate(syncId); }
      catch (err: any) { logger.warn('sync.notifier', 'pushImmediate threw', { syncId, error: err?.message }); }
    });

    // ── STARTUP RECOVERY: Reset sync items that were mid-flight when app crashed/restarted ──
    // Items with attempts > 0 but no synced_at may have been interrupted mid-push.
    // Reset their next_retry_at so they're immediately eligible for the next sync cycle.
    const recovered = this.db.prepare(`
      UPDATE sync_queue
      SET next_retry_at = NULL
      WHERE synced_at IS NULL AND next_retry_at IS NOT NULL
    `).run();
    if (recovered.changes > 0) {
      logger.info('sync.startup', 'Recovered sync items stuck from previous session', { count: recovered.changes });
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
        // Verify-against-cloud reconciliation runs every 5 minutes, not every
        // minute — it makes a network call so we don't want to hammer Supabase
        // when the queue is healthy. Self-heals stuck UPDATE rows by querying
        // cloud truth: if the cloud row is past or beyond our queued state,
        // discard the row instead of letting it retry forever.
        const now = Date.now();
        if (now - this.lastReconcileAt >= SyncEngine.RECONCILE_INTERVAL_MS) {
          this.lastReconcileAt = now;
          void this.reconcileStuckSyncItems();
        }
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

      logger.info('sync.startup', 'Proactively refreshing access token...');
      this.cachedAccessToken = null; // force fresh
      const token = await this.refreshAccessToken();
      if (token) {
        logger.info('sync.startup', 'Token refreshed — station is ready');
        // Immediately sync pending items with fresh token
        this.syncNow();
        this.pullLatest();
      } else {
        logger.warn('sync.startup', 'Token refresh failed — user may need to re-login');
      }
    } catch (err: any) {
      logger.warn('sync.startup', 'Startup refresh error', { error: err?.message });
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
      logger.info('sync.shutdown', 'Offline — skipping flush');
      return;
    }

    const pending = this.db.prepare(
      "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    if (!pending?.c) {
      logger.info('sync.shutdown', 'No pending items — clean shutdown');
      return;
    }

    logger.info('sync.shutdown', 'Flushing pending items before quit...', { count: pending.c });
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
        logger.warn('sync.shutdown', 'Items still pending — will retry on next launch', { count: remaining.c });
      } else {
        logger.info('sync.shutdown', 'All items flushed successfully');
      }
    } catch (err: any) {
      logger.warn('sync.shutdown', 'Flush failed', { error: err?.message });
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.pullInterval) clearInterval(this.pullInterval);
    if (this.autoResolveInterval) clearInterval(this.autoResolveInterval);
    this.disconnectRealtime();
    // Unregister the notifier so stale engine references can't fire.
    setSyncNotifier(null);
  }

  /**
   * Live mode-change hook. The IPC handler in main.ts persists the new
   * mode in the session table and then calls this to apply runtime
   * effects without a restart:
   *   - cloud → local_backup: drop the realtime WS, run one final drain
   *     of anything pending so the queue is empty entering local mode.
   *   - local_backup → cloud: reset the backup throttle, reconnect
   *     realtime, kick a sync + pull so anything that accumulated locally
   *     gets pushed and any divergent cloud state is pulled back.
   */
  applyModeChange(target: 'cloud' | 'local_backup') {
    logger.info('sync.applyModeChange', 'Mode change requested', { target });
    if (target === 'local_backup') {
      this.disconnectRealtime();
      // One final drain so we don't carry the existing backlog into the
      // first backup window. lastBackupAt stays at 0, so this drain runs
      // ungated; subsequent syncNow ticks will be gated by the 6h window.
      void this.syncNow();
    } else {
      // Switching back to cloud: reset throttle and resync from scratch.
      this.lastBackupAt = 0;
      void this.connectRealtime();
      void this.syncNow();
      void this.pullLatest();
    }
  }

  // ── Supabase Realtime: instant cloud→station push ──────────────
  // When mobile/web updates a ticket in Supabase, the station hears it immediately
  // via WebSocket instead of waiting for the next 5s poll.

  private async connectRealtime() {
    if (this.realtimeWs) return; // already connected
    // local_backup mode: don't subscribe to realtime — Station is its own
    // source of truth, no incoming cloud changes are wanted.
    if (this.getMode() === 'local_backup') return;

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
      // Captured at open-time so onmessage can filter notifications safely.
      const sessionOrgId: string | null = session?.organization_id ?? null;

      ws.onopen = () => {
        logger.info('realtime', 'Connected to Supabase Realtime');
        // Authenticate with access token for RLS
        ws.send(JSON.stringify({
          topic: 'realtime:auth',
          event: 'access_token',
          payload: { access_token: token },
          ref: 'auth',
        }));

        // Join the tickets channel for our offices.
        // Also subscribe to ticket_items so the Kitchen Display picks up
        // items added on Expo / web instantly (org-scoped — RLS narrows
        // further). Without this, ticket_items only refresh on the 5s
        // pull tick, which feels laggy in a live kitchen.
        const orgId: string | null = session?.organization_id ?? null;
        const ticketItemsChange = orgId
          ? [{ event: '*', schema: 'public', table: 'ticket_items', filter: `organization_id=eq.${orgId}` }]
          : [];
        // Subscribe to notifications too — used for cross-device kitchen
        // alerts ("Order ready: Table 1 — ..."). RLS already scopes per
        // org; we filter client-side by office_id from the payload.
        const notificationsChange = [{ event: 'INSERT', schema: 'public', table: 'notifications' }];
        const joinMsg = JSON.stringify({
          topic: `realtime:public:tickets`,
          event: 'phx_join',
          payload: { config: { broadcast: { self: false }, postgres_changes: [
            { event: '*', schema: 'public', table: 'tickets', filter: `office_id=in.(${session.office_ids.join(',')})` },
            ...ticketItemsChange,
            ...notificationsChange,
          ] } },
          ref: '1',
        });
        ws.send(joinMsg);

        // Join the config channel: departments/services/desks/offices/office_holidays.
        // Any change → immediate pullLatest (debounced below). No office filter on
        // services (no office_id column); RLS scopes the event stream to the user's org.
        const configJoin = JSON.stringify({
          topic: `realtime:public:config`,
          event: 'phx_join',
          payload: { config: { broadcast: { self: false }, postgres_changes: [
            { event: '*', schema: 'public', table: 'departments', filter: `office_id=in.(${session.office_ids.join(',')})` },
            { event: '*', schema: 'public', table: 'services' },
            { event: '*', schema: 'public', table: 'desks', filter: `office_id=in.(${session.office_ids.join(',')})` },
            { event: '*', schema: 'public', table: 'offices', filter: `id=in.(${session.office_ids.join(',')})` },
            { event: '*', schema: 'public', table: 'office_holidays', filter: `office_id=in.(${session.office_ids.join(',')})` },
            { event: '*', schema: 'public', table: 'restaurant_tables', filter: `office_id=in.(${session.office_ids.join(',')})` },
          ] } },
          ref: '2',
        });
        ws.send(configJoin);

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

          // Intercept kitchen-ready notifications and forward to renderer
          // for an immediate toast — no need to wait for the pull tick.
          // Filter on office to avoid cross-org leakage despite RLS.
          try {
            const data = msg.payload?.data;
            const isInsert = data?.type === 'INSERT' || msg.event === 'INSERT';
            const tbl = data?.table;
            const rec = data?.record;
            if (isInsert && tbl === 'notifications' && rec?.type === 'kitchen_ready') {
              const inner = rec.payload || {};
              const officeOk = !inner.office_id || session.office_ids.includes(inner.office_id);
              const orgOk = !inner.organization_id || (sessionOrgId && inner.organization_id === sessionOrgId);
              if (officeOk && orgOk) {
                for (const win of BrowserWindow.getAllWindows()) {
                  if (!win.isDestroyed()) win.webContents.send('kitchen:order-ready', inner);
                }
              }
            }
          } catch { /* non-fatal */ }

          if (isChange) {
            logger.info('realtime', 'Ticket change detected — pulling immediately');
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
        logger.info('realtime', 'Disconnected, will retry in 5s');
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
      logger.warn('realtime', 'Failed to connect', { error: err?.message });
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
              logger.warn('sync.health', 'Connection is FLAKY', { consecutiveSlowChecks: this.consecutiveSlowChecks, latencyMs: this.healthLatencyMs });
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
            logger.info('sync.health', 'Connection recovered', { latencyMs: this.healthLatencyMs });
          }
          this.consecutiveSlowChecks = 0;
          this.connectionQuality = 'good';
        }
      } else {
        this.consecutiveSlowChecks = 0;
        this.connectionQuality = 'offline';
      }

      if (wasOffline && this.isOnline) {
        // Reset auth failure tracking — network just resumed, give refresh a fresh chance
        this.consecutiveRefreshFailures = 0;
        this.firstRefreshFailureAt = 0;
        // Proactively refresh token immediately on reconnection
        await this.ensureFreshToken();
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
      logger.warn('sync.queue', 'Pending sync items piling up — check connection', { pendingCount: this.pendingCount });
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

  /**
   * Fill in organization_id on sync_queue rows that were enqueued
   * before the column existed, or where the derivation lookup missed
   * (parent row not yet in local DB at enqueue time). Runs each sync
   * cycle — cheap because rows settle to a non-NULL value quickly.
   */
  private backfillNullOrgIds(): void {
    try {
      const rows = this.db.prepare(
        `SELECT id, table_name, record_id, payload
         FROM sync_queue
         WHERE synced_at IS NULL AND organization_id IS NULL
         LIMIT 200`
      ).all() as Array<{ id: string; table_name: string; record_id: string; payload: string }>;
      if (!rows.length) return;
      const upd = this.db.prepare(`UPDATE sync_queue SET organization_id = ? WHERE id = ?`);
      let filled = 0;
      for (const r of rows) {
        try {
          const parsed = r.payload ? JSON.parse(r.payload) : {};
          const orgId = deriveOrgIdForSyncItem(this.db, r.table_name, r.record_id, parsed);
          if (orgId) { upd.run(orgId, r.id); filled++; }
        } catch { /* skip bad row */ }
      }
      if (filled > 0) logger.debug('sync.backfill', 'Resolved organization_id on pending rows', { filled, scanned: rows.length });
    } catch (err: any) {
      logger.debug('sync.backfill', 'Backfill pass failed', { error: err?.message });
    }
  }

  /**
   * Split the pending queue into the active business + others. Used by
   * the diagnostics panel so admins can see "5 items from another
   * business" at a glance and choose to discard or ignore them.
   */
  getPendingBreakdown(): {
    activeOrgId: string | null;
    active: number;
    foreign: number;
    unresolved: number;
    foreignByOrg: Array<{ organization_id: string; count: number }>;
  } {
    const session = this.getSessionFromDB();
    const activeOrgId: string | null = session?.organization_id ?? null;
    const active = (this.db.prepare(
      `SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND organization_id = ?`
    ).get(activeOrgId ?? '') as any)?.c ?? 0;
    const foreign = (this.db.prepare(
      `SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND organization_id IS NOT NULL AND organization_id != ?`
    ).get(activeOrgId ?? '') as any)?.c ?? 0;
    const unresolved = (this.db.prepare(
      `SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND organization_id IS NULL`
    ).get() as any)?.c ?? 0;
    const foreignByOrg = this.db.prepare(
      `SELECT organization_id, COUNT(*) as count
       FROM sync_queue
       WHERE synced_at IS NULL AND organization_id IS NOT NULL AND organization_id != ?
       GROUP BY organization_id ORDER BY count DESC`
    ).all(activeOrgId ?? '') as Array<{ organization_id: string; count: number }>;
    return { activeOrgId, active, foreign, unresolved, foreignByOrg };
  }

  /**
   * Silent background cleanup: retire pending items from other
   * businesses that have been sitting longer than the grace window.
   *
   * Scope is deliberately narrow — ONLY append-only event logs:
   *   • ticket_events (audit trail)
   *   • ticket_audit_log
   *
   * These can be lost without affecting any ticket, customer, or
   * operational record. Anything else (tickets, desks, departments,
   * offices, services, organizations, notifications) stays pending
   * forever and requires an explicit "Discard items from other
   * businesses" click so no real business data is ever silently
   * dropped. The yellow banner still surfaces those so the operator
   * knows they're there.
   */
  private autoDiscardForeignOrphans(): void {
    const GRACE_MS = 5 * 60 * 1000; // 5 minutes
    const AUTO_DISCARDABLE_TABLES = ['ticket_events', 'ticket_audit_log'];
    try {
      const session = this.getSessionFromDB();
      const activeOrgId: string | null = session?.organization_id ?? null;
      if (!activeOrgId) return; // no session yet — don't touch anything
      const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
      const placeholders = AUTO_DISCARDABLE_TABLES.map(() => '?').join(',');
      const res = this.db.prepare(
        `UPDATE sync_queue
            SET synced_at = ?, last_error = 'discarded:foreign-org-auto'
          WHERE synced_at IS NULL
            AND organization_id IS NOT NULL
            AND organization_id != ?
            AND created_at < ?
            AND table_name IN (${placeholders})`
      ).run(new Date().toISOString(), activeOrgId, cutoff, ...AUTO_DISCARDABLE_TABLES);
      if (res.changes > 0) {
        logger.info('sync.autoDiscard', 'Retired orphaned foreign-org event-log rows', { count: res.changes, activeOrgId });
        this.updatePendingCount();
      }
    } catch (err: any) {
      logger.debug('sync.autoDiscard', 'Cleanup pass failed', { error: err?.message });
    }
  }

  /**
   * Discard all pending items that belong to organizations other than
   * the active one. Irreversible — used when the admin confirms the
   * orphaned items are from a previous business they no longer manage.
   */
  discardForeignItems(): number {
    const session = this.getSessionFromDB();
    const activeOrgId: string | null = session?.organization_id ?? null;
    const res = this.db.prepare(
      `UPDATE sync_queue SET synced_at = ?, last_error = 'discarded:foreign-org'
       WHERE synced_at IS NULL AND organization_id IS NOT NULL AND organization_id != ?`
    ).run(new Date().toISOString(), activeOrgId ?? '');
    return res.changes ?? 0;
  }

  // Core refresh — calls Supabase auth endpoint with refresh_token
  // Falls back to silent re-auth with stored encrypted credentials if refresh_token is dead
  private async refreshAccessToken(): Promise<string | null> {
    // PURE TOKEN AUTH: Only use refresh_token. No password storage.
    // Each device gets its own session at login time. The main process
    // is the single source of truth for tokens. Only trigger re-login
    // after sustained failures over a meaningful time window (not just
    // a burst after sleep/wake).
    const AUTH_FAILURE_THRESHOLD = 15;           // consecutive failures needed
    const AUTH_FAILURE_TIME_WINDOW = 3 * 60_000; // failures must span 3+ minutes

    const session = this.getSessionFromDB();
    if (!session?.refresh_token) {
      const err = createQfError('QF-AUTH-003', { reason: 'no refresh_token in session' });
      logger.warn('sync.token', err.message, { code: err.code });
      // No refresh token — try silent re-auth immediately
      const reAuthToken = await this.attemptSilentReAuth();
      if (reAuthToken) return reAuthToken;
      this.trackRefreshFailure();
      if (this.shouldTriggerAuthError(AUTH_FAILURE_THRESHOLD, AUTH_FAILURE_TIME_WINDOW)) {
        this.onAuthError();
      }
      return null;
    }

    try {
      logger.info('sync.token', 'Refreshing access token via refresh_token...');
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
        const err = createQfError('QF-AUTH-002', { status: res.status, body: body.slice(0, 200) });
        logger.warn('sync.token', err.message, { code: err.code, status: res.status });

        // Refresh token is dead — try silent re-auth with stored credentials
        const reAuthToken = await this.attemptSilentReAuth();
        if (reAuthToken) return reAuthToken;

        this.trackRefreshFailure();
        if (this.shouldTriggerAuthError(AUTH_FAILURE_THRESHOLD, AUTH_FAILURE_TIME_WINDOW)) {
          this.onAuthError();
        }
        return null;
      }

      const data = await res.json();
      if (!data.access_token) return null;

      const updated = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? session.refresh_token,
      };
      // Use UPDATE (not INSERT OR REPLACE) to preserve station_token column for kiosk auth
      this.db.prepare("UPDATE session SET value = ? WHERE key = 'current'").run(JSON.stringify(updated));

      this.cachedAccessToken = data.access_token;
      this.lastTokenRefreshAt = Date.now();
      this.consecutiveRefreshFailures = 0;
      this.firstRefreshFailureAt = 0;

      logger.info('sync.token', 'Access token refreshed successfully');
      try { this.onTokenRefreshed(data.access_token, updated.refresh_token); } catch {}
      return data.access_token;
    } catch (err: any) {
      // Network errors (timeout, DNS, etc.) — don't count toward auth failures
      // These are connectivity issues, not auth issues
      const qfErr = createQfError('QF-NET-001', { error: err?.message });
      logger.warn('sync.token', 'Token refresh network error', { code: qfErr.code, error: err?.message ?? err });
      return null;
    }
  }

  /** Track a refresh failure with timing info */
  private trackRefreshFailure() {
    this.consecutiveRefreshFailures++;
    if (this.firstRefreshFailureAt === 0) {
      this.firstRefreshFailureAt = Date.now();
    }
  }

  /** Only trigger auth error after sustained failures over a time window */
  private shouldTriggerAuthError(threshold: number, timeWindowMs: number): boolean {
    if (Date.now() <= this.authErrorSuppressedUntil) return false;
    if (this.consecutiveRefreshFailures < threshold) return false;
    // Failures must span at least the time window (not just a burst after wake)
    const failureDuration = Date.now() - this.firstRefreshFailureAt;
    if (failureDuration < timeWindowMs) return false;
    return true;
  }

  /**
   * Silent re-authentication using stored email/password.
   * Called when refresh_token is dead — attempts a full sign-in behind the scenes.
   * If successful, updates session tokens and the user never sees anything.
   * Returns fresh access_token or null if re-auth failed.
   */
  public async attemptSilentReAuth(): Promise<string | null> {
    if (this.silentReAuthInFlight) return null; // prevent concurrent attempts
    this.silentReAuthInFlight = true;

    try {
      const creds = await this.getStoredCreds();
      if (!creds?.email || !creds?.password) {
        logger.info('sync.reauth', 'No stored credentials — cannot re-authenticate silently');
        return null;
      }

      logger.info('sync.reauth', 'Attempting silent re-authentication...');
      const res = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn('sync.reauth', 'Silent re-auth failed', { status: res.status, body: body.slice(0, 200) });
        return null;
      }

      const data = await res.json();
      if (!data.access_token || !data.refresh_token) return null;

      // Update session in DB with fresh tokens
      const session = this.getSessionFromDB();
      const updated = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
      // Use UPDATE (not INSERT OR REPLACE) to preserve station_token column for kiosk auth
      this.db.prepare("UPDATE session SET value = ? WHERE key = 'current'").run(JSON.stringify(updated));

      this.cachedAccessToken = data.access_token;
      this.lastTokenRefreshAt = Date.now();
      this.consecutiveRefreshFailures = 0;
      this.firstRefreshFailureAt = 0;

      logger.info('sync.reauth', 'Silent re-authentication successful — session restored');
      try { this.onTokenRefreshed(data.access_token, data.refresh_token); } catch {}
      return data.access_token;
    } catch (err: any) {
      logger.warn('sync.reauth', 'Silent re-auth error', { error: err?.message });
      return null;
    } finally {
      this.silentReAuthInFlight = false;
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
    logger.warn('sync.token', 'Could not get fresh token — sync will likely fail');
    return dbToken ?? this.supabaseKey;
  }

  /**
   * Flush prerequisite sync items before pushing a CALL/UPDATE.
   * Ensures:
   *   1. The ticket's INSERT exists in Supabase (can't PATCH a non-existent row)
   *   2. Previous desk occupant is cleared (served/cancelled/no_show synced first)
   */
  private async flushPrerequisites(item: any) {
    const authToken = await this.ensureFreshToken();
    const payload = JSON.parse(item.payload || '{}');

    // 1. Ensure ticket INSERT is synced first
    const pendingInsert = this.db.prepare(
      "SELECT * FROM sync_queue WHERE synced_at IS NULL AND record_id = ? AND table_name = 'tickets' AND operation = 'INSERT'"
    ).get(item.record_id) as any;

    if (pendingInsert) {
      logger.info('sync.prerequisites', 'Flushing pending INSERT before CALL/UPDATE', { recordId: item.record_id });
      try {
        const res = await this.replayMutation(pendingInsert, authToken);
        if (res.status === 0) {
          this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
            .run(new Date().toISOString(), pendingInsert.id);
          this.rewriteOfflineTicket(pendingInsert.record_id, pendingInsert.payload);
          this.createWhatsAppSessionForTicket(pendingInsert.record_id, pendingInsert.payload);
          logger.info('sync.prerequisites', 'INSERT flushed successfully');
        }
      } catch (err: any) {
        logger.warn('sync.prerequisites', 'INSERT flush failed — CALL/UPDATE will proceed anyway', { error: err?.message });
      }
    }

    // 2. For CALL operations: clear the desk by flushing pending terminal-state mutations
    if (payload.status === 'called' && payload.desk_id) {
      // Find tickets currently assigned to this desk in Supabase (they might be stale)
      // and flush any pending served/cancelled/no_show mutations for those tickets
      const deskTicketIds = (this.db.prepare(
        "SELECT id FROM tickets WHERE desk_id = ? AND status IN ('served', 'cancelled', 'no_show') AND id != ?"
      ).all(payload.desk_id, item.record_id) as any[]).map((r: any) => r.id);

      if (deskTicketIds.length > 0) {
        const pendingClears = this.db.prepare(
          `SELECT * FROM sync_queue WHERE synced_at IS NULL AND table_name = 'tickets'
           AND record_id IN (${deskTicketIds.map(() => '?').join(',')})
           AND json_extract(payload, '$.status') IN ('served', 'cancelled', 'no_show')
           ORDER BY created_at ASC`
        ).all(...deskTicketIds) as any[];

        for (const clearItem of pendingClears) {
          logger.info('sync.prerequisites', 'Flushing desk-clearing mutation before CALL', {
            recordId: clearItem.record_id, status: JSON.parse(clearItem.payload || '{}').status, deskId: payload.desk_id,
          });
          try {
            const res = await this.replayMutation(clearItem, authToken);
            if (res.status === 0) {
              this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
                .run(new Date().toISOString(), clearItem.id);
              logger.info('sync.prerequisites', 'Desk-clearing mutation flushed');
            }
          } catch (err: any) {
            logger.warn('sync.prerequisites', 'Desk-clearing flush failed', { error: err?.message });
          }
        }
      }

      // Also flush any pending "serving" state for the SAME desk (previous ticket still in serving state)
      const servingOnDesk = (this.db.prepare(
        "SELECT id FROM tickets WHERE desk_id = ? AND status IN ('called', 'serving') AND id != ?"
      ).all(payload.desk_id, item.record_id) as any[]).map((r: any) => r.id);

      if (servingOnDesk.length > 0) {
        const pendingTransitions = this.db.prepare(
          `SELECT * FROM sync_queue WHERE synced_at IS NULL AND table_name = 'tickets'
           AND record_id IN (${servingOnDesk.map(() => '?').join(',')})
           ORDER BY created_at ASC`
        ).all(...servingOnDesk) as any[];

        for (const transItem of pendingTransitions) {
          logger.info('sync.prerequisites', 'Flushing pending transition for desk occupant', {
            recordId: transItem.record_id, operation: transItem.operation,
          });
          try {
            const res = await this.replayMutation(transItem, authToken);
            if (res.status === 0) {
              this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
                .run(new Date().toISOString(), transItem.id);
            }
          } catch (err: any) {
            logger.warn('sync.prerequisites', 'Desk occupant transition flush failed', { error: err?.message });
          }
        }
      }
    }
  }

  /**
   * Fire-and-forget: immediately push a specific sync_queue item to Supabase.
   * Called right after a local mutation to minimize cloud display lag.
   * On failure, schedules rapid retries (2s, 5s, 15s) before falling back to syncNow().
   */
  async pushImmediate(syncQueueId: string, _retryAttempt = 0) {
    if (!this.isOnline) return;
    // local_backup mode: don't push individual rows on enqueue. The row
    // sits in sync_queue and goes out as part of the next scheduled
    // backup drain. This is what makes the mode "feel offline" — no
    // network traffic per ticket, no per-row failures lighting up the UI.
    if (this.getMode() === 'local_backup') return;

    const item = this.db.prepare(
      "SELECT * FROM sync_queue WHERE id = ? AND synced_at IS NULL"
    ).get(syncQueueId) as any;
    if (!item) {
      this.rapidRetryInFlight.delete(syncQueueId);
      return;
    }

    // ── DEPENDENCY ORDERING ──────────────────────────────────────────
    // Before pushing a CALL/UPDATE, ensure prerequisites are synced first.
    // This prevents two key failures:
    //   1. CALL on a ticket whose INSERT hasn't reached Supabase yet → 0 rows
    //   2. CALL on a desk that still has a called/serving ticket in Supabase
    //      because the previous COMPLETE/NO_SHOW hasn't synced yet → trigger rejection
    if (_retryAttempt === 0 && (item.operation === 'CALL' || item.operation === 'UPDATE')) {
      await this.flushPrerequisites(item);
    }

    try {
      const authToken = await this.ensureFreshToken();
      const result = await this.replayMutation(item, authToken);

      if (result.status === 0) {
        this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
          .run(new Date().toISOString(), item.id);
        this.updatePendingCount();
        this.rapidRetryInFlight.delete(syncQueueId);
        logger.info('sync.pushImmediate', 'Pushed successfully', { operation: item.operation, table: item.table_name, recordId: item.record_id });

        // Rewrite L- prefix after successful INSERT push
        if (item.operation === 'INSERT' && item.table_name === 'tickets') {
          this.rewriteOfflineTicket(item.record_id, item.payload);
          this.createWhatsAppSessionForTicket(item.record_id, item.payload);
        }
        return;
      }

      if (result.status === 409) {
        // Desk conflict — previous ticket still active in cloud.
        // flushPrerequisites should have cleared it, but if it didn't,
        // schedule a gentle retry. Don't count as consecutive failure.
        logger.info('sync.pushImmediate', 'Desk conflict — scheduling retry without penalty', { syncQueueId });
        this.rapidRetryInFlight.add(syncQueueId);
        setTimeout(() => this.pushImmediate(syncQueueId, _retryAttempt), 3000);
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
            logger.info('sync.pushImmediate', 'Pushed after token refresh');
            if (item.operation === 'INSERT' && item.table_name === 'tickets') {
              this.rewriteOfflineTicket(item.record_id, item.payload);
              this.createWhatsAppSessionForTicket(item.record_id, item.payload);
            }
            return;
          }
        }
        // Auth refresh failed — try anon key as last resort (RLS allows public ticket updates)
        if (item.table_name === 'tickets') {
          logger.info('sync.pushImmediate', 'Auth failed — trying anon key for ticket', { recordId: item.record_id });
          const anonRetry = await this.replayMutation(item, this.supabaseKey);
          if (anonRetry.status === 0) {
            this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
              .run(new Date().toISOString(), item.id);
            this.updatePendingCount();
            this.rapidRetryInFlight.delete(syncQueueId);
            logger.info('sync.pushImmediate', 'Pushed ticket with anon key');
            if (item.operation === 'INSERT') {
              this.rewriteOfflineTicket(item.record_id, item.payload);
              this.createWhatsAppSessionForTicket(item.record_id, item.payload);
            }
            return;
          }
        }
      }

      // Non-auth failure — schedule rapid retry
      // Record the error on the row itself so operators see WHY it's
      // stuck instead of a blank "attempts: 0" entry sitting forever.
      try {
        this.db.prepare(
          "UPDATE sync_queue SET last_error = ? WHERE id = ? AND synced_at IS NULL"
        ).run(`push#${_retryAttempt + 1}: status ${result.status}`, syncQueueId);
      } catch { /* best-effort */ }
      this.scheduleRapidRetry(syncQueueId, _retryAttempt);
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      logger.info('sync.pushImmediate', 'Attempt failed', { attempt: _retryAttempt + 1, error: errMsg });
      // Same rationale — push the raw error to last_error so the
      // diagnostics panel can show the underlying reason rather than an
      // empty row that looks like it's never been tried.
      try {
        this.db.prepare(
          "UPDATE sync_queue SET last_error = ? WHERE id = ? AND synced_at IS NULL"
        ).run(`push#${_retryAttempt + 1}: ${errMsg.slice(0, 180)}`, syncQueueId);
      } catch { /* best-effort */ }

      // PATCH 0 rows on critical status = likely RLS/auth issue.
      // Try anon key before giving up (RLS has a public update policy for tickets).
      if (item.table_name === 'tickets' && errMsg.includes('PATCH 0 rows')) {
        try {
          logger.info('sync.pushImmediate', '0-row PATCH — trying anon key', { recordId: item.record_id });
          // Force fresh login first
          this.cachedAccessToken = null;
          const freshToken = await this.refreshAccessToken();
          const tokenToUse = freshToken || this.supabaseKey;
          const anonRetry = await this.replayMutation(item, tokenToUse);
          if (anonRetry.status === 0) {
            this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
              .run(new Date().toISOString(), item.id);
            this.updatePendingCount();
            this.rapidRetryInFlight.delete(syncQueueId);
            logger.info('sync.pushImmediate', 'Pushed ticket after fresh login/anon fallback');
            return;
          }
        } catch (retryErr: any) {
          logger.warn('sync.pushImmediate', 'Anon/fresh fallback also failed', { error: retryErr?.message });
        }
      }

      this.scheduleRapidRetry(syncQueueId, _retryAttempt);
    }
  }

  /** Schedule rapid retry: 2s → 5s → 15s → give up (syncNow takes over) */
  private scheduleRapidRetry(syncQueueId: string, currentAttempt: number) {
    if (currentAttempt >= SyncEngine.RAPID_RETRY_DELAYS.length) {
      this.rapidRetryInFlight.delete(syncQueueId);
      logger.info('sync.pushImmediate', 'Rapid retries exhausted — syncNow will handle it', { syncQueueId });

      // Notify renderer about critical sync failures so the operator sees a warning
      try {
        const item = this.db.prepare("SELECT * FROM sync_queue WHERE id = ? AND synced_at IS NULL").get(syncQueueId) as any;
        if (item) {
          const payload = JSON.parse(item.payload || '{}');
          const isCritical = item.table_name === 'tickets' && ['called', 'serving'].includes(payload.status);
          if (isCritical) {
            // Try to find the ticket number for the error message
            const ticketRow = this.db.prepare("SELECT ticket_number FROM tickets WHERE id = ?").get(item.record_id) as any;
            const ticketNum = ticketRow?.ticket_number ?? item.record_id;
            logger.error('sync.pushImmediate', 'CRITICAL: Failed to sync after all retries', { status: payload.status, ticketNumber: ticketNum });
            this.onTicketError({
              message: `WhatsApp notification may not have been sent for ticket ${ticketNum}. The "called" status did not sync to cloud. Try clicking "Force Sync" in the status bar.`,
              ticketNumber: ticketNum,
              type: 'sync_critical_failure',
            });
          }
        }
      } catch { /* ignore parse errors */ }
      return;
    }
    if (this.rapidRetryInFlight.has(syncQueueId) && currentAttempt > 0) return; // already scheduled
    this.rapidRetryInFlight.add(syncQueueId);

    const delay = SyncEngine.RAPID_RETRY_DELAYS[currentAttempt];
    logger.info('sync.pushImmediate', 'Scheduling retry', { attempt: currentAttempt + 1, maxAttempts: 3, delayMs: delay });
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

      // ── Hard guards: never touch a row that isn't a fresh L- offline ticket ──
      if (!ticket) return;
      if (!ticket.ticket_number || !ticket.ticket_number.startsWith('L-')) return;
      if (ticket.is_offline !== 1) return;
      if (!ticket.department_id) return;

      const oldNumber: string = ticket.ticket_number;
      const token = await this.ensureFreshToken();

      // ── Use the SAME atomic RPC the online insert path uses ──
      // This is timezone-correct (uses office tz), atomic (no race), and
      // produces the canonical 4-digit format. Eliminates the after-midnight
      // reset bug entirely (no client-side date math, no client-side max query).
      let properNumber: string | null = null;
      let properSequence: number | null = null;
      try {
        const rpcRes = await fetch(
          `${this.supabaseUrl}/rest/v1/rpc/generate_daily_ticket_number`,
          {
            method: 'POST',
            headers: {
              apikey: this.supabaseKey,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_department_id: ticket.department_id }),
            signal: AbortSignal.timeout(5000),
          }
        );
        if (rpcRes.ok) {
          const rows = await rpcRes.json();
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row?.ticket_num && row?.seq) {
            properNumber = String(row.ticket_num);
            properSequence = Number(row.seq);
          }
        }
      } catch { /* fall through — we'll abort safely below */ }

      // If RPC failed for any reason, leave the ticket alone (keeps L- prefix
      // working). Better to show L-G-005 than to risk overwriting with a wrong
      // number. The next sync cycle will retry naturally.
      if (!properNumber || !properSequence) {
        logger.warn('sync.rewrite', 'RPC unavailable, leaving ticket as-is', { ticketNumber: oldNumber });
        return;
      }

      // ── Compare-and-swap on the cloud PATCH ──
      // Only update the cloud row if it STILL has the old L- number. If
      // anything else has touched it (another sync, manual edit, etc.) we
      // skip rather than clobber.
      const patchRes = await fetch(
        `${this.supabaseUrl}/rest/v1/tickets?id=eq.${recordId}&ticket_number=eq.${encodeURIComponent(oldNumber)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: this.supabaseKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            ticket_number: properNumber,
            daily_sequence: properSequence,
            is_offline: false,
          }),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!patchRes.ok) {
        logger.warn('sync.rewrite', 'PATCH failed — leaving ticket as-is', { status: patchRes.status, ticketNumber: oldNumber });
        return;
      }

      // Verify the PATCH actually matched a row (compare-and-swap could miss)
      const updated = await patchRes.json().catch(() => []);
      if (!Array.isArray(updated) || updated.length === 0) {
        logger.warn('sync.rewrite', 'CAS missed — cloud row changed', { recordId, ticketNumber: oldNumber });
        return;
      }

      // ── Only NOW update local SQLite (cloud is the source of truth) ──
      this.db.prepare("UPDATE tickets SET ticket_number = ?, daily_sequence = ?, is_offline = 0 WHERE id = ? AND ticket_number = ?")
        .run(properNumber, properSequence, recordId, oldNumber);

      logger.info('sync.rewrite', 'Ticket number rewritten', { from: oldNumber, to: properNumber, sequence: properSequence });
      this.onDataPulled(); // refresh UI with proper number
    } catch (err: any) {
      logger.warn('sync.rewrite', 'Failed to rewrite ticket', { recordId, error: err?.message });
      // Non-critical — ticket still works with L- prefix, just cosmetic
    }
  }

  /**
   * After a ticket INSERT syncs to cloud, create a whatsapp_session if the ticket
   * has a customer phone — so the customer receives WhatsApp notifications.
   */
  private async createWhatsAppSessionForTicket(recordId: string, rawPayload?: string) {
    try {
      let payload: any = null;
      if (rawPayload) {
        try { payload = JSON.parse(rawPayload); } catch { return; }
      }
      const cd = payload?.customer_data;
      const rawPhone = typeof cd?.phone === 'string' ? cd.phone.trim() : null;
      if (!rawPhone) return;

      const officeId = payload?.office_id;
      if (!officeId) return;

      // Get org timezone + country code for phone normalization
      const token = await this.ensureFreshToken();
      const officeRes = await fetch(
        `${this.supabaseUrl}/rest/v1/offices?id=eq.${officeId}&select=organization_id,settings`,
        { headers: { apikey: this.supabaseKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }
      );
      if (!officeRes.ok) return;
      const offices = await officeRes.json();
      const office = offices[0];
      if (!office?.organization_id) return;

      // Fetch org-level timezone (single source of truth)
      let tz = 'Africa/Algiers';
      try {
        const orgRes = await fetch(
          `${this.supabaseUrl}/rest/v1/organizations?id=eq.${office.organization_id}&select=timezone`,
          { headers: { apikey: this.supabaseKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) }
        );
        if (orgRes.ok) {
          const orgs = await orgRes.json();
          if (orgs[0]?.timezone) tz = orgs[0].timezone;
        }
      } catch { /* fallback */ }
      const cc = office.settings?.country_code;
      const normalized = this.normalizePhoneForWA(rawPhone, tz, cc);
      if (!normalized) return;

      await fetch(`${this.supabaseUrl}/rest/v1/whatsapp_sessions`, {
        method: 'POST',
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          organization_id: office.organization_id,
          ticket_id: recordId,
          office_id: officeId,
          department_id: payload.department_id,
          service_id: payload.service_id || null,
          whatsapp_phone: normalized,
          channel: 'whatsapp',
          state: 'active',
          locale: 'fr',
        }),
        signal: AbortSignal.timeout(5000),
      });
      logger.info('sync.wa-session', 'Created WhatsApp session for ticket', { recordId, phoneLast4: normalized.slice(-4) });
    } catch (err: any) {
      logger.warn('sync.wa-session', 'Failed to create WhatsApp session', { recordId, error: err?.message });
    }
  }

  private normalizePhoneForWA(phone: string, tz?: string, cc?: string): string | null {
    // normalizePhone imported statically at top — dynamic require() breaks in asar
    return normalizePhone(phone, tz, cc);
  }

  async syncNow() {
    logger.info('sync.syncNow', 'entry', { online: this.isOnline, circuitOpen: this.circuitOpen });
    if (!this.isOnline) return;
    if (!this.checkCircuitBreaker()) return; // circuit breaker open — skip

    // ── Local + Backup mode: only run when the backup window is due ──
    // Stations in local_backup mode don't push in real time. Instead, the
    // sync_queue accumulates locally and we drain it once per backup
    // interval (default 6h) as a safety-net upload to cloud. Between
    // drains, syncNow is a no-op so the diagnostics panel stays quiet
    // and the network is left alone.
    const mode = this.getMode();
    if (mode === 'local_backup') {
      const now = Date.now();
      if (now - this.lastBackupAt < SyncEngine.BACKUP_SNAPSHOT_INTERVAL_MS) {
        return; // still inside the backup window — skip
      }
      // Window elapsed: continue into the regular drain loop, then mark
      // the backup as complete at the bottom of this function.
      logger.info('sync.syncNow', 'Local+Backup window elapsed — running scheduled drain', {
        sinceLastBackupMs: now - this.lastBackupAt,
      });
    }

    // Watchdog: promote any row stuck at attempts=0 for >30s BEFORE
    // selecting. Guarantees no item can silently sit unprocessed.
    const thirtySecAgo = new Date(Date.now() - 30 * 1000).toISOString();
    const watchdog = this.db.prepare(
      `UPDATE sync_queue
          SET next_retry_at = NULL,
              last_error = COALESCE(last_error, 'watchdog:promoted')
        WHERE synced_at IS NULL
          AND attempts = 0
          AND (next_retry_at IS NULL OR next_retry_at > ?)
          AND created_at < ?`
    ).run(new Date().toISOString(), thirtySecAgo);
    if (watchdog.changes > 0) {
      logger.warn('sync.watchdog', 'Promoted rows stuck at attempts=0', { count: watchdog.changes });
    }

    // Late-derive organization_id on legacy/NULL rows so the scoped
    // SELECT below can route them. A row only stays NULL when we
    // genuinely can't resolve it (e.g. parent ticket purged locally);
    // those are left alone and surface separately in diagnostics.
    this.backfillNullOrgIds();

    // Auto-discard orphans from previous businesses. Items belonging
    // to an organization other than the current session's are never
    // retried under the wrong auth — they'd just sit forever. If they
    // haven't been cleared manually within the grace window, retire
    // them silently so the queue drains to a clean state. The grace
    // window protects the legitimate case of the operator briefly
    // switching businesses and then coming back; pending work for
    // their original business survives for 5 minutes.
    this.autoDiscardForeignOrphans();

    // Scope to the current session's organization. Items belonging to
    // other businesses are left pending (attempts untouched) so they
    // sync correctly when the user signs back into that business —
    // they're never retried under the wrong auth.
    const session = this.getSessionFromDB();
    const currentOrgId: string | null = session?.organization_id ?? null;
    const now = new Date().toISOString();

    // Diagnostic dump at info level so we can see exactly why a row is
    // being excluded. Logs the first three pending items with their
    // organization_id vs. the current session's org — comparing those
    // two values is usually enough to explain any "stuck forever" case.
    try {
      const breakdown = this.db.prepare(
        `SELECT
           SUM(CASE WHEN organization_id IS NULL THEN 1 ELSE 0 END) as unresolved,
           SUM(CASE WHEN organization_id = ? THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN organization_id IS NOT NULL AND organization_id != ? THEN 1 ELSE 0 END) as foreign_count
         FROM sync_queue WHERE synced_at IS NULL`
      ).get(currentOrgId ?? '', currentOrgId ?? '') as any;
      const totalPending = (breakdown?.active ?? 0) + (breakdown?.unresolved ?? 0) + (breakdown?.foreign_count ?? 0);
      if (totalPending > 0) {
        const sample = this.db.prepare(
          `SELECT id, table_name, operation, organization_id, attempts, last_error, next_retry_at,
                  CAST((strftime('%s','now') - strftime('%s', created_at)) AS INTEGER) as age_sec
             FROM sync_queue
            WHERE synced_at IS NULL
            ORDER BY created_at ASC LIMIT 3`
        ).all() as any[];
        logger.info('sync.syncNow', 'queue state', {
          currentOrgId,
          now,
          unresolved: breakdown.unresolved,
          active: breakdown.active,
          foreign: breakdown.foreign_count,
          sample: sample.map((s) => ({
            id: s.id.slice(0, 28),
            table: s.table_name,
            operation: s.operation,
            orgMatch: s.organization_id == null ? 'null'
              : s.organization_id === currentOrgId ? 'match' : 'foreign',
            attempts: s.attempts,
            lastError: s.last_error,
            nextRetryAt: s.next_retry_at,
            ageSec: s.age_sec,
          })),
        });
      }
    } catch { /* ignore logging failures */ }

    // Commercial-grade replay: no scope filter on the SELECT. Every
    // unsynced, off-cooldown row gets a real push attempt. If a row
    // belongs to another business, the POST fails cleanly with 401/403
    // and `autoDiscardForeignOrphans` retires event-log rows after the
    // 5-min grace; real-data rows stay visible in the foreign banner
    // for manual review. Previous "scope filter" attempts kept rows
    // sitting at attempts=0 forever when organization_id was stamped
    // correctly but SQLite string comparison flaked.
    //
    // attempts < 10 cap still applies to non-critical UPDATEs.
    // Critical mutations (CALL transitions, INSERTs) remain immortal.
    const pending = this.db.prepare(
      `SELECT * FROM sync_queue
       WHERE synced_at IS NULL
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
         AND (
           operation = 'INSERT'
           OR json_extract(payload, '$.status') IN ('called','serving','cancelled','served','no_show')
           OR attempts < 10
         )
       ORDER BY created_at ASC LIMIT 50`
    ).all(now) as any[];
    logger.info('sync.syncNow', 'selected pending', { count: pending.length });

    if (pending.length === 0) return;

    this.onStatus('syncing');

    // ── BULLETPROOF: Get a verified-fresh token before replaying anything ──
    let authToken = await this.ensureFreshToken();
    let tokenIsVerified = !this.isTokenExpired(authToken);

    if (!tokenIsVerified) {
      logger.warn('sync.syncNow', 'Token is expired and refresh failed — will attempt mutations anyway');
    }

    let had401 = false;
    let authRefreshAttempted = false;
    let authRecovered = false;
    let authExpiredCount = 0;
    let successCount = 0;

    for (const item of pending) {
      try {
        const result = await this.replayMutation(item, authToken);

        if (result.status === 409) {
          // Desk conflict — transient, don't count as a hard failure
          // (no circuit-breaker tick), but we DO need to (a) bump
          // last_error every cycle so diagnostics shows the real reason
          // a row is sitting (not the stale 'watchdog:promoted'), and
          // (b) cap the retry count so a row whose prerequisite COMPLETE
          // is permanently lost can't sit looping for hours. After
          // CONFLICT_MAX cycles we treat the CALL as a ghost — the
          // operator has long since moved on, the desk in cloud is
          // someone else's, our update is stale and pointless.
          const CONFLICT_MAX = 12; // ~12 cycles ≈ 1 min of retries
          const newAttempts = (item.attempts ?? 0) + 1;
          if (newAttempts >= CONFLICT_MAX) {
            this.db.prepare(
              "UPDATE sync_queue SET synced_at = ?, last_error = ? WHERE id = ? AND synced_at IS NULL"
            ).run(
              new Date().toISOString(),
              `GHOST_CALL: superseded after ${newAttempts} desk conflicts`,
              item.id,
            );
            logger.warn('sync.syncNow', 'Auto-discarded ghost CALL after conflict cap', {
              recordId: item.record_id,
              attempts: newAttempts,
            });
          } else {
            this.db.prepare(
              "UPDATE sync_queue SET attempts = ?, last_error = ? WHERE id = ?"
            ).run(newAttempts, `DESK_CONFLICT × ${newAttempts}`, item.id);
            logger.info('sync.syncNow', 'Desk conflict — will retry next cycle', {
              recordId: item.record_id,
              attempts: newAttempts,
            });
          }
          continue;
        }

        if (result.status === 401) {
          had401 = true;
          // ── 401: try to refresh the token ONCE per cycle, then keep
          // processing the rest of the batch with whatever we end up
          // with. Do NOT `break` — one bad token must never stall items
          // queued behind it. Each item that still 401s gets individually
          // flagged AUTH_EXPIRED so the operator sees exactly what failed.
          if (!authRefreshAttempted) {
            authRefreshAttempted = true;
            logger.info('sync.syncNow', 'Got 401 — forcing token refresh and retrying this item...');
            this.cachedAccessToken = null;
            const newToken = await this.refreshAccessToken();
            if (newToken) {
              authToken = newToken;
              const retry = await this.replayMutation(item, authToken);
              if (retry.status === 0) {
                this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
                  .run(new Date().toISOString(), item.id);
                successCount++;
                authRecovered = true;
                if (item.operation === 'INSERT' && item.table_name === 'tickets') {
                  this.rewriteOfflineTicket(item.record_id, item.payload);
                  this.createWhatsAppSessionForTicket(item.record_id, item.payload);
                }
                continue;
              }
              // Retry with fresh token still failed — try anon key for tickets
              if (item.table_name === 'tickets') {
                try {
                  const anonRetry = await this.replayMutation(item, this.supabaseKey);
                  if (anonRetry.status === 0) {
                    this.db.prepare("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ?")
                      .run(new Date().toISOString(), item.id);
                    successCount++;
                    if (item.operation === 'INSERT') {
                      this.rewriteOfflineTicket(item.record_id, item.payload);
                      this.createWhatsAppSessionForTicket(item.record_id, item.payload);
                    }
                    continue;
                  }
                } catch { /* fall through to AUTH_EXPIRED flag */ }
              }
            } else {
              // Silent re-auth attempt as a fallback — but don't block processing
              void this.attemptSilentReAuth().then((tok) => {
                if (tok) {
                  logger.info('sync', 'Silent re-auth succeeded in background — next cycle will use fresh token');
                  this.db.prepare(
                    "UPDATE sync_queue SET last_error = NULL WHERE synced_at IS NULL AND last_error = 'AUTH_EXPIRED: re-login required'"
                  ).run();
                  this.updatePendingCount();
                }
              }).catch(() => {});
            }
          }

          // Token refresh failed (or this is the Nth 401 this cycle):
          // flag THIS item only and move on. Other items in the batch
          // (e.g. ticket_events that use anon-key inserts, or items that
          // happen to hit a server that revalidated) may still succeed.
          // Counter tells the operator at a glance how persistent the
          // auth issue is ("AUTH_EXPIRED × 47" vs a one-off blip).
          const authBumpAttempts = (item.attempts ?? 0) + 1;
          this.db.prepare(
            "UPDATE sync_queue SET attempts = ?, last_error = ? WHERE id = ? AND synced_at IS NULL"
          ).run(
            authBumpAttempts,
            `AUTH_EXPIRED × ${authBumpAttempts}: re-login required`,
            item.id,
          );
          authExpiredCount++;
          continue;
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

        // Rewrite offline ticket number after successful INSERT push
        if (item.operation === 'INSERT' && item.table_name === 'tickets') {
          this.rewriteOfflineTicket(item.record_id, item.payload);
          this.createWhatsAppSessionForTicket(item.record_id, item.payload);
        }
      } catch (err: any) {
        // Non-auth error: exponential backoff
        const newAttempts = (item.attempts ?? 0) + 1;
        const errMsg = err?.message ?? 'Unknown error';

        // ── Soft-fail cap for "cloud already past us" classes ──
        // When the cloud row has already advanced past the local
        // target state (e.g. ticket is `served` in cloud but we have
        // a queued CALL because the operator clicked Call before sync
        // caught up), the PATCH matches 0 rows. Without a cap, the
        // critical-status carve-out in the SELECT keeps the row alive
        // indefinitely — every cycle re-throws "PATCH 0 rows for
        // called — needs retry". Same shape as the desk-conflict 409:
        // the local intent is permanently superseded; auto-discard
        // after a small cap and surface a clear ghost label.
        const SOFT_FAIL_CAP = 12; // ~12 cycles ≈ 1 min after backoff kicks in
        const isPatchGhost = /PATCH 0 rows/i.test(errMsg);
        if (isPatchGhost && newAttempts >= SOFT_FAIL_CAP) {
          this.db.prepare(
            "UPDATE sync_queue SET synced_at = ?, last_error = ?, attempts = ? WHERE id = ? AND synced_at IS NULL"
          ).run(
            new Date().toISOString(),
            `GHOST_PATCH: cloud row past target state after ${newAttempts} attempts`,
            newAttempts,
            item.id,
          );
          logger.warn('sync.syncNow', 'Auto-discarded ghost PATCH after soft-fail cap', {
            recordId: item.record_id,
            attempts: newAttempts,
            error: errMsg.slice(0, 120),
          });
          continue; // don't tick circuit breaker — this is a stale-intent
        }

        const delayMs = Math.min(15000 * Math.pow(2, newAttempts - 1), 300000);
        const nextRetry = new Date(Date.now() + delayMs).toISOString();
        // Tag the error message with a counter for ghost-class failures
        // so the diagnostics panel shows the recurrence ("PATCH 0 rows × 8")
        // rather than a stale message that looks like a one-off.
        const taggedErr = isPatchGhost
          ? `PATCH 0 rows × ${newAttempts} (ghost): ${errMsg.slice(0, 120)}`
          : errMsg;
        this.db.prepare(
          "UPDATE sync_queue SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?"
        ).run(newAttempts, taggedErr, nextRetry, item.id);

        // Circuit breaker: track consecutive failures — but DON'T
        // count ghost-class failures (cloud is already correct, we
        // just have a stale local intent; tripping the breaker would
        // pause every other healthy mutation for nothing).
        if (!isPatchGhost) {
          this.recordPushFailure(errMsg);
          if (this.circuitOpen) break; // circuit tripped — stop processing
        }

        // Notify UI on 3rd failure so staff knows something is stuck
        if (newAttempts === 3 && item.table_name === 'tickets' && !isPatchGhost) {
          const payload = JSON.parse(item.payload || '{}');
          this.onTicketError({
            message: `Sync failed for ticket ${payload.ticket_number ?? item.record_id}: ${errMsg}`,
            ticketNumber: payload.ticket_number,
            type: 'sync_failed',
          });
        }
      }
    }

    if (successCount > 0) {
      logger.info('sync.syncNow', 'Successfully synced items', { successCount, totalCount: pending.length });
    }

    // If any items hit AUTH_EXPIRED and we could not recover in-flight,
    // fire the auth-error callback once so the UI can prompt re-login.
    // We fire it exactly once per cycle (via authErrorSuppressedUntil) to
    // avoid modal-spam when many items are flagged.
    if (had401 && !authRecovered && authExpiredCount > 0) {
      logger.warn('sync', 'Auth expired — items flagged, processing continued', { authExpiredCount, pending: pending.length });
      if (Date.now() > this.authErrorSuppressedUntil) {
        this.onAuthError();
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.updatePendingCount();
    this.onStatus('online');

    // In local_backup mode, this drain just satisfied the scheduled
    // backup window. Stamp lastBackupAt so syncNow goes silent until
    // the next backup interval elapses.
    if (mode === 'local_backup') {
      this.lastBackupAt = Date.now();
      logger.info('sync.syncNow', 'Local+Backup snapshot complete', { successCount, total: pending.length });
    }

    // Clean up old synced items (> 24h)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?").run(cutoff);

    // ── Auto-discard rules ──
    // CRITICAL invariant: critical-status mutations (called, serving, cancelled,
    // served, no_show) are IMMORTAL. They retry forever until the cloud accepts
    // them. Losing a call/cancel silently breaks the queue state.
    //
    // INSERTs are also immortal (never discard a ticket creation).
    //
    // Only NON-INSERT, NON-CRITICAL items (e.g. recall_count++, desk_id reassign,
    // notes update) are eligible for auto-discard after 3 attempts or 4h age.
    const isCriticalSql = `(
      json_extract(payload, '$.status') IN ('called','serving','cancelled','served','no_show')
    )`;

    const discarded = this.db.prepare(
      `DELETE FROM sync_queue
        WHERE synced_at IS NULL
          AND attempts >= 3
          AND operation != 'INSERT'
          AND NOT ${isCriticalSql}`
    ).run();
    if (discarded.changes > 0) {
      logger.warn('sync', 'Auto-discarded non-terminal sync items after 3 failed attempts', { count: discarded.changes });
      this.updatePendingCount();
    }

    // Orphan rule: only purge sync items whose target ticket no longer exists
    // locally AT ALL. Do NOT purge items just because the local row is now
    // cancelled/served — those are exactly the rows we MUST push to cloud.
    const orphanDiscarded = this.db.prepare(`
      DELETE FROM sync_queue
       WHERE synced_at IS NULL
         AND table_name = 'tickets'
         AND operation != 'INSERT'
         AND NOT ${isCriticalSql}
         AND record_id NOT IN (SELECT id FROM tickets)
    `).run();
    if (orphanDiscarded.changes > 0) {
      logger.warn('sync', 'Auto-discarded sync items for deleted tickets', { count: orphanDiscarded.changes });
      this.updatePendingCount();
    }

    // 4-hour stale rule: applies only to non-terminal items.
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const staleDiscarded = this.db.prepare(
      `DELETE FROM sync_queue
        WHERE synced_at IS NULL
          AND operation != 'INSERT'
          AND created_at < ?
          AND NOT ${isCriticalSql}`
    ).run(fourHoursAgo);
    if (staleDiscarded.changes > 0) {
      logger.warn('sync', 'Auto-discarded stale non-terminal sync items older than 4 hours', { count: staleDiscarded.changes });
      this.updatePendingCount();
    }

    // Surface stuck terminal items (they will keep retrying forever)
    const stuckTerminal = this.db.prepare(
      `SELECT COUNT(*) as c FROM sync_queue
        WHERE synced_at IS NULL AND attempts >= 5 AND ${isCriticalSql}`
    ).get() as any;
    if (stuckTerminal?.c > 0) {
      logger.warn('sync', 'TERMINAL status mutations stuck after 5+ attempts — will keep retrying forever', { count: stuckTerminal.c });
    }

    // Warn about stuck INSERT items
    const stuckInserts = this.db.prepare(
      "SELECT COUNT(*) as c FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation = 'INSERT'"
    ).get() as any;
    if (stuckInserts?.c > 0) {
      logger.warn('sync', 'Ticket INSERTs stuck after 5+ attempts — will keep retrying', { count: stuckInserts.c });
    }
  }

  // Returns { status: 0 } on success, { status: httpCode } on failure
  // 401 is returned separately so the caller can refresh token and retry
  private async replayMutation(item: any, authToken: string): Promise<{ status: number }> {
    const payload = JSON.parse(item.payload);
    // Strip local-only columns that don't exist in the remote schema.
    // Adding fields here is safer than letting Supabase reject the whole UPDATE.
    if (item.table_name === 'tickets') {
      delete payload.cancelled_at;
      delete payload.is_offline;
    }
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

        // 400 on ticket INSERT likely means qr_token collision — regenerate and retry once
        if (res.status === 400 && item.table_name === 'tickets' && payload.qr_token) {
          const errBody = await res.text().catch(() => '');
          logger.warn('sync.replay', 'INSERT 400 for ticket', { recordId: item.record_id, body: errBody.substring(0, 200) });
          if (errBody.includes('qr_token') || errBody.includes('duplicate') || errBody.includes('unique')) {
            const { randomUUID } = require('crypto');
            payload.qr_token = randomUUID().replace(/-/g, '').slice(0, 12);
            // Update payload in sync_queue so the new qr_token persists across retries
            this.db.prepare("UPDATE sync_queue SET payload = ? WHERE id = ?")
              .run(JSON.stringify(payload), item.id);
            // Also update local SQLite ticket
            this.db.prepare("UPDATE tickets SET qr_token = ? WHERE id = ?")
              .run(payload.qr_token, item.record_id);
            logger.info('sync.replay', 'Regenerated qr_token, retrying...', { recordId: item.record_id });
            const retryRes = await fetch(baseUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(10000),
            });
            if (retryRes.ok || retryRes.status === 409) return { status: 0 };
          }
        }

        // 400 might be auth-related (expired JWT)
        if (res.status === 400) {
          const errText = await res.text().catch(() => '');
          if (/jwt|token|expir|auth|invalid claim/i.test(errText)) return { status: 401 };
          throw new Error(`INSERT failed: 400 — ${errText.slice(0, 100)}`);
        }
        throw new Error(`INSERT failed: ${res.status}`);
      }

      case 'UPDATE':
      case 'CALL': {
        const patchHeaders = { ...headers, Prefer: 'return=representation' };

        // Build URL with optimistic locking: prevent overwriting terminal states
        let patchUrl = `${baseUrl}?id=eq.${item.record_id}`;
        if (payload.status) {
          const terminalStatuses = item.table_name === 'tickets'
            ? ['served', 'cancelled', 'no_show']
            : item.table_name === 'appointments'
              ? ['completed', 'cancelled', 'no_show', 'declined']
              : null;
          if (terminalStatuses) {
            // Don't overwrite a row already in a terminal state
            patchUrl += `&status=not.in.(${terminalStatuses.join(',')})`;
          }
        }

        res = await fetch(patchUrl, {
          method: 'PATCH',
          headers: patchHeaders,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401 || res.status === 403) return { status: 401 };
        // 400 from Supabase — could be auth, desk conflict, or constraint violation
        if (res.status === 400) {
          const errBody = await res.text().catch(() => '');
          const isAuthRelated = /jwt|token|expir|auth|invalid claim/i.test(errBody);
          logger.warn('sync.replay', 'PATCH 400', { recordId: item.record_id, authRelated: isAuthRelated, body: errBody.slice(0, 200) });
          if (isAuthRelated) return { status: 401 };

          // Desk-conflict errors (P0001 from enforce_one_active_per_desk / check_desk_capacity)
          // These are TRANSIENT — the desk will be freed once the previous ticket's COMPLETE syncs.
          // Return special status 409 (conflict) so callers can retry without tripping circuit breaker.
          const isDeskConflict = /active ticket|desk.*capacity|P0001/i.test(errBody);
          if (isDeskConflict && payload.status === 'called') {
            logger.info('sync.replay', 'Desk conflict — previous ticket still active in cloud, will retry', { recordId: item.record_id, deskId: payload.desk_id });
            return { status: 409 };
          }

          // CHECK constraint violation (23514) — could be status mismatch or other data issue
          // Log details for diagnosis but still throw to trigger retry
          if (/23514/i.test(errBody)) {
            logger.error('sync.replay', 'CHECK constraint violation', { recordId: item.record_id, payload: JSON.stringify(payload).slice(0, 200), body: errBody.slice(0, 300) });
          }

          throw new Error(`UPDATE failed: 400 — ${errBody.slice(0, 100)}`);
        }
        if (res.ok) {
          // Check if Supabase actually updated any rows (RLS or status conflict = empty array)
          const body = await res.json().catch(() => []);
          if (Array.isArray(body) && body.length === 0) {
            // PATCH returned 0 rows — could be:
            // a) Terminal-state precondition: row already advanced past our target → safe to skip
            // b) RLS blocked or row changed remotely → may need retry for critical ops
            const terminalTicket = ['served', 'cancelled', 'no_show'];
            const terminalAppt = ['completed', 'cancelled', 'no_show', 'declined'];
            const isTerminalConflict = payload.status && (
              (item.table_name === 'tickets' && terminalTicket.includes(payload.status)) ||
              (item.table_name === 'appointments' && terminalAppt.includes(payload.status))
            );
            if (isTerminalConflict) {
              // Row is already in a terminal state — our update is stale, safe to skip
              logger.info('sync.replay', 'PATCH 0 rows — row already in terminal state, skipping', { status: payload.status, recordId: item.record_id });
              return { status: 0 };
            }
            const isCritical = ['called', 'serving', 'cancelled', 'served', 'no_show'].includes(payload.status);
            const hasDataUpdate = payload.notes !== undefined || payload.priority !== undefined;
            if (isCritical || hasDataUpdate) {
              // ── IMMEDIATE GHOST DETECTION ──
              // PATCH returned 0 rows. Don't blindly retry 12 cycles. Do a single
              // HEAD lookup to find out WHY the row didn't match:
              //   (a) row missing in cloud → orphan, discard now
              //   (b) row exists but past target state → superseded, discard now
              //   (c) row exists at expected prior state → genuine RLS/race, retry
              // This collapses ~3 minutes of red diagnostics into one cycle for
              // the two common ghost causes. Only case (c) — actual contention —
              // still uses the retry path.
              if (item.table_name === 'tickets') {
                try {
                  const headUrl = `${baseUrl}?id=eq.${item.record_id}&select=id,status`;
                  const headRes = await fetch(headUrl, { headers, signal: AbortSignal.timeout(5000) });
                  if (headRes.ok) {
                    const rows = await headRes.json().catch(() => []);
                    if (Array.isArray(rows) && rows.length === 0) {
                      logger.warn('sync.replay', 'Ghost detected — row missing in cloud, discarding', { recordId: item.record_id, targetStatus: payload.status });
                      return { status: 0 }; // orphan: row never made it to cloud
                    }
                    if (Array.isArray(rows) && rows[0]?.status) {
                      const cloudStatus = rows[0].status as string;
                      const terminal = ['served', 'cancelled', 'no_show'];
                      const rank: Record<string, number> = { waiting: 0, called: 1, serving: 2, served: 3, no_show: 3, cancelled: 3 };
                      const cloudRank = rank[cloudStatus] ?? 0;
                      const targetRank = rank[payload.status] ?? 0;
                      if (terminal.includes(cloudStatus) || cloudRank >= targetRank) {
                        logger.info('sync.replay', 'Ghost detected — cloud past target state, discarding', { recordId: item.record_id, cloudStatus, targetStatus: payload.status });
                        return { status: 0 }; // superseded: cloud already at/past where we wanted
                      }
                    }
                  }
                } catch (e: any) {
                  // HEAD-check failed (network blip) — fall through to retry path
                  logger.warn('sync.replay', 'Ghost HEAD-check failed, falling back to retry', { recordId: item.record_id, error: e?.message });
                }
              }
              logger.warn('sync.replay', 'PATCH returned 0 rows — will retry', { status: payload.status, hasNotes: !!payload.notes, recordId: item.record_id });
              throw new Error(`PATCH 0 rows for ${payload.status || 'data update'} — needs retry`);
            }
            logger.warn('sync.replay', 'PATCH returned 0 rows — row was likely changed/deleted remotely', { operation: item.operation, recordId: item.record_id });
            // Still mark as synced to avoid infinite retries on a conflict
            return { status: 0 };
          }
          return { status: 0 };
        }
        if (res.status === 409) return { status: 0 };
        throw new Error(`UPDATE failed: ${res.status}`);
      }

      case 'DELETE': {
        res = await fetch(`${baseUrl}?id=eq.${item.record_id}`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok || res.status === 404) return { status: 0 };
        if (res.status === 401 || res.status === 403) return { status: 401 };
        throw new Error(`DELETE failed: ${res.status}`);
      }

      default:
        throw new Error(`Unknown operation: ${item.operation}`);
    }
  }

  // Pull latest data from cloud to local cache
  async pullLatest() {
    if (!this.isOnline) return;
    // In local_backup mode the Station is the authoritative source for its
    // own data — pulling cloud state would clobber legitimate local edits
    // with whatever's in cloud (often older or stamped by the last backup).
    // Skip entirely; cloud is a one-way backup destination in this mode.
    if (this.getMode() === 'local_backup') return;

    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.office_ids?.length) {
      logger.info('sync.pullLatest', 'No session or office_ids, skipping pull');
      return;
    }
    logger.info('sync.pullLatest', 'Pulling for offices', { officeIds: session.office_ids });

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

      // Pull offices, departments, services, desks, holidays, restaurant_tables in parallel
      const [officesRes, deptsRes, svcsRes, desksRes, holidaysRes, tablesRes] = await Promise.all([
        fetch(`${this.supabaseUrl}/rest/v1/offices?or=(${officeFilter})&select=id,name,address,organization_id,settings,operating_hours,timezone`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/departments?or=(${officeInFilter})&select=id,name,code,office_id`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/services?select=id,name,department_id,estimated_service_time`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/desks?or=(${officeInFilter})&select=id,name,display_name,department_id,office_id,is_active,current_staff_id,status`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/office_holidays?or=(${officeInFilter})&select=id,office_id,holiday_date,name,is_full_day,open_time,close_time`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
        fetch(`${this.supabaseUrl}/rest/v1/restaurant_tables?or=(${officeInFilter})&select=id,office_id,code,label,zone,capacity,min_party_size,max_party_size,reservable,status,current_ticket_id,assigned_at,created_at,updated_at`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
      ]);

      const now = new Date().toISOString();

      if (officesRes.ok) {
        const offices = await officesRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO offices (id, name, address, organization_id, settings, operating_hours, timezone, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const o of offices) {
          stmt.run(o.id, o.name, o.address, o.organization_id, JSON.stringify(o.settings ?? {}), JSON.stringify(o.operating_hours ?? {}), o.timezone ?? null, now);
        }
      }

      let remoteDeptIds: string[] = [];
      if (deptsRes.ok) {
        const depts = await deptsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO departments (id, name, code, office_id, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const d of depts) {
          stmt.run(d.id, d.name, d.code, d.office_id, now);
          remoteDeptIds.push(d.id);
        }
        // Cascade-delete: remove local departments in our offices that no longer exist remotely
        const keep = new Set(remoteDeptIds);
        const localDepts = this.db.prepare(
          `SELECT id FROM departments WHERE office_id IN (${officeIds.map(() => '?').join(',')})`
        ).all(...officeIds) as Array<{ id: string }>;
        const delDept = this.db.prepare(`DELETE FROM departments WHERE id = ?`);
        for (const row of localDepts) {
          if (!keep.has(row.id)) delDept.run(row.id);
        }
      }

      if (svcsRes.ok) {
        const svcs = await svcsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO services (id, name, department_id, estimated_service_time, updated_at) VALUES (?, ?, ?, ?, ?)`);
        const remoteSvcIds = new Set<string>();
        for (const s of svcs) {
          stmt.run(s.id, s.name, s.department_id, s.estimated_service_time ?? 10, now);
          remoteSvcIds.add(s.id);
        }
        // Cascade-delete: remove local services whose department belongs to our offices
        // but which no longer exist remotely (scope the delete to avoid touching other orgs).
        if (remoteDeptIds.length > 0) {
          const localSvcs = this.db.prepare(
            `SELECT id FROM services WHERE department_id IN (${remoteDeptIds.map(() => '?').join(',')})`
          ).all(...remoteDeptIds) as Array<{ id: string }>;
          const delSvc = this.db.prepare(`DELETE FROM services WHERE id = ?`);
          for (const row of localSvcs) {
            if (!remoteSvcIds.has(row.id)) delSvc.run(row.id);
          }
        }
      }

      if (desksRes.ok) {
        const desks = await desksRes.json();
        // Protect locally-modified desks (e.g. operator just tapped "En pause" on
        // mobile) from being overwritten by a pull that races ahead of our push.
        // Any desk with a pending sync_queue UPDATE is considered locally-owned
        // until that UPDATE syncs — skip overwriting its status & current_staff_id.
        const pendingDeskIds = new Set(
          (this.db.prepare(
            "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'desks'"
          ).all() as any[]).map((r: any) => r.record_id)
        );
        const fullStmt = this.db.prepare(`INSERT OR REPLACE INTO desks (id, name, display_name, department_id, office_id, is_active, current_staff_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        // For locally-modified desks: refresh only static metadata, keep local status/current_staff_id
        const metaStmt = this.db.prepare(`UPDATE desks SET name = ?, display_name = ?, department_id = ?, office_id = ?, is_active = ?, updated_at = ? WHERE id = ?`);
        const remoteDeskIds = new Set<string>();
        for (const d of desks) {
          remoteDeskIds.add(d.id);
          if (pendingDeskIds.has(d.id)) {
            metaStmt.run(d.name, d.display_name ?? null, d.department_id, d.office_id, d.is_active ? 1 : 0, now, d.id);
          } else {
            fullStmt.run(d.id, d.name, d.display_name ?? null, d.department_id, d.office_id, d.is_active ? 1 : 0, d.current_staff_id, d.status ?? 'open', now);
          }
        }
        // Cascade-delete: remove local desks in our offices that no longer exist remotely.
        // Skip desks with pending local changes — those must finish syncing first.
        const localDesks = this.db.prepare(
          `SELECT id FROM desks WHERE office_id IN (${officeIds.map(() => '?').join(',')})`
        ).all(...officeIds) as Array<{ id: string }>;
        const delDesk = this.db.prepare(`DELETE FROM desks WHERE id = ?`);
        for (const row of localDesks) {
          if (!remoteDeskIds.has(row.id) && !pendingDeskIds.has(row.id)) delDesk.run(row.id);
        }
      }

      // ── Restaurant tables ────────────────────────────────────────
      // Cloud → SQLite mirror so the floor map renders in local mode
      // (Expo via /api/station/query) and offline on Station itself.
      if (tablesRes && tablesRes.ok) {
        try {
          const rows = await tablesRes.json();
          const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO restaurant_tables
             (id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          const remoteIds = new Set<string>();
          for (const r of rows) {
            remoteIds.add(r.id);
            stmt.run(
              r.id,
              r.office_id,
              r.code ?? null,
              r.label ?? null,
              r.zone ?? null,
              typeof r.capacity === 'number' ? r.capacity : 4,
              r.min_party_size ?? null,
              r.max_party_size ?? null,
              r.reservable === false ? 0 : 1,
              r.status ?? null,
              r.current_ticket_id ?? null,
              r.assigned_at ?? null,
              r.created_at ?? null,
              r.updated_at ?? null,
            );
          }
          // Cascade-delete: drop local rows in our offices that no longer exist remotely
          const localRows = this.db.prepare(
            `SELECT id FROM restaurant_tables WHERE office_id IN (${officeIds.map(() => '?').join(',')})`
          ).all(...officeIds) as Array<{ id: string }>;
          const del = this.db.prepare(`DELETE FROM restaurant_tables WHERE id = ?`);
          for (const row of localRows) {
            if (!remoteIds.has(row.id)) del.run(row.id);
          }
        } catch (e: any) {
          logger.warn('sync', 'restaurant_tables pull failed', { error: e?.message });
        }
      }

      // Fire config-changed callback if any reference table changed
      try {
        const depRows = this.db.prepare(`SELECT id, name, code, office_id FROM departments ORDER BY id`).all() as any[];
        const svcRows = this.db.prepare(`SELECT id, name, department_id, estimated_service_time FROM services ORDER BY id`).all() as any[];
        const deskRows = this.db.prepare(`SELECT id, name, display_name, department_id, office_id, is_active FROM desks ORDER BY id`).all() as any[];
        const configHash = JSON.stringify({ d: depRows, s: svcRows, k: deskRows });
        if (configHash !== this.lastConfigHash) {
          this.lastConfigHash = configHash;
          this.onConfigChanged();
        }
      } catch { /* ignore */ }

      // ── Menu (categories + items) ─────────────────────────────
      // Pull menu rows for the active org. Skip for unsynced local rows
      // (same protection as desks) so edits made here survive the pull.
      const orgId: string | null = session?.organization_id ?? null;
      if (orgId) {
        try {
          const [menuCatsRes, menuItemsRes, ticketItemsRes, ticketPaymentsRes] = await Promise.all([
            fetch(`${this.supabaseUrl}/rest/v1/menu_categories?organization_id=eq.${orgId}&select=id,organization_id,name,sort_order,color,icon,active,created_at,updated_at`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
            fetch(`${this.supabaseUrl}/rest/v1/menu_items?organization_id=eq.${orgId}&select=id,organization_id,category_id,name,price,discount_percent,sort_order,active,prep_time_minutes,is_available,image_url,created_at,updated_at`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
            // Ticket items are scoped to the org; we pull for tickets the station already has.
            fetch(`${this.supabaseUrl}/rest/v1/ticket_items?organization_id=eq.${orgId}&select=id,ticket_id,organization_id,menu_item_id,name,price,qty,note,added_at,added_by,kitchen_status,kitchen_status_at`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
            fetch(`${this.supabaseUrl}/rest/v1/ticket_payments?organization_id=eq.${orgId}&select=id,ticket_id,organization_id,method,amount,tendered,change_given,note,paid_at,paid_by`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null),
          ]);

          if (menuCatsRes?.ok) {
            const rows = await menuCatsRes.json();
            const pendingIds = new Set((this.db.prepare(
              "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'menu_categories'"
            ).all() as any[]).map((r: any) => r.record_id));
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO menu_categories (id, organization_id, name, sort_order, color, icon, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const r of rows) {
              if (pendingIds.has(r.id)) continue;
              stmt.run(r.id, r.organization_id, r.name, r.sort_order ?? 0, r.color ?? null, r.icon ?? null, r.active === false ? 0 : 1, r.created_at ?? null, r.updated_at ?? null);
            }
          }
          if (menuItemsRes?.ok) {
            const rows = await menuItemsRes.json();
            const pendingIds = new Set((this.db.prepare(
              "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'menu_items'"
            ).all() as any[]).map((r: any) => r.record_id));
            // INSERT OR REPLACE wipes the row, so every column we want to
            // keep MUST be in the bindings — otherwise locally-saved values
            // (prep_time_minutes, is_available, image_url) get blown away
            // by the next 5-second pull. This is exactly the bug that made
            // prep times reset on restart before this fix.
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO menu_items (id, organization_id, category_id, name, price, discount_percent, sort_order, active, prep_time_minutes, is_available, image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const r of rows) {
              if (pendingIds.has(r.id)) continue;
              stmt.run(
                r.id,
                r.organization_id,
                r.category_id,
                r.name,
                r.price ?? null,
                Math.max(0, Math.min(100, Number(r.discount_percent ?? 0) || 0)),
                r.sort_order ?? 0,
                r.active === false ? 0 : 1,
                typeof r.prep_time_minutes === 'number' ? r.prep_time_minutes : null,
                r.is_available === false ? 0 : 1,
                r.image_url ?? null,
                r.created_at ?? null,
                r.updated_at ?? null,
              );
            }
          }
          if (ticketItemsRes?.ok) {
            const rows = await ticketItemsRes.json();
            const pendingIds = new Set((this.db.prepare(
              "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'ticket_items'"
            ).all() as any[]).map((r: any) => r.record_id));
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO ticket_items (id, ticket_id, organization_id, menu_item_id, name, price, qty, note, added_at, added_by, kitchen_status, kitchen_status_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const r of rows) {
              if (pendingIds.has(r.id)) continue;
              stmt.run(r.id, r.ticket_id, r.organization_id, r.menu_item_id ?? null, r.name, r.price ?? null, r.qty ?? 1, r.note ?? null, r.added_at, r.added_by ?? null, r.kitchen_status ?? 'new', r.kitchen_status_at ?? null);
            }
            // Reconcile deletes — sync only does INSERT OR REPLACE, so rows
            // deleted on Expo / web would otherwise linger locally and keep
            // showing on the Kitchen Display. Delete any local row for this
            // org that no longer exists in the cloud snapshot, except those
            // pending push (we still own them locally).
            try {
              const cloudIds = new Set<string>(rows.map((r: any) => String(r.id)));
              const localIds = this.db.prepare(
                `SELECT id FROM ticket_items WHERE organization_id = ?`
              ).all(orgId) as any[];
              const del = this.db.prepare(`DELETE FROM ticket_items WHERE id = ?`);
              for (const row of localIds) {
                if (!cloudIds.has(row.id) && !pendingIds.has(row.id)) {
                  del.run(row.id);
                }
              }
            } catch { /* non-fatal */ }
          }
          if (ticketPaymentsRes?.ok) {
            const rows = await ticketPaymentsRes.json();
            const pendingIds = new Set((this.db.prepare(
              "SELECT DISTINCT record_id FROM sync_queue WHERE synced_at IS NULL AND table_name = 'ticket_payments'"
            ).all() as any[]).map((r: any) => r.record_id));
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO ticket_payments (id, ticket_id, organization_id, method, amount, tendered, change_given, note, paid_at, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const r of rows) {
              if (pendingIds.has(r.id)) continue;
              stmt.run(r.id, r.ticket_id, r.organization_id, r.method ?? 'cash', r.amount ?? 0, r.tendered ?? null, r.change_given ?? null, r.note ?? null, r.paid_at, r.paid_by ?? null);
            }
          }
        } catch (err: any) {
          logger.warn('sync.pullLatest', 'Menu pull failed (non-fatal)', { error: err?.message });
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
         completed_at, cancelled_at, parked_at, recall_count, notes, is_remote, appointment_id, source, synced_at,
         delivery_address, assigned_rider_id, dispatched_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "SELECT status, desk_id, called_by_staff_id, called_at, serving_started_at, cancelled_at FROM tickets WHERE id = ?"
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
              const hasPendingSync = (checkPending.get(t.id) as any)?.c > 0;

              // RULE: cloud is the single source of truth. The business queue MUST always
              // match what customers see on WhatsApp / Messenger / tracking / displays (they
              // all read from Supabase directly). The only reason to keep a more-advanced
              // local status is when the Station has an UNPUSHED change in sync_queue —
              // in that case the cloud hasn't seen our mutation yet and a pull-downgrade
              // would clobber a legitimate local operator action. Otherwise, cloud wins.
              if (hasPendingSync) {
                logger.info('sync.pull', 'Skipping downgrade — pending sync exists', { ticketNumber: t.ticket_number, localStatus: local.status, localRank, cloudStatus: t.status, cloudRank });
                continue;
              }

              logger.info('sync.pull', 'Cloud overrides local — no pending sync', { ticketNumber: t.ticket_number, localStatus: local.status, cloudStatus: t.status });
              if (local.status === 'cancelled' && ['waiting', 'called', 'serving'].includes(t.status)) {
                logTicketEvent(t.id, 'restored_from_cloud', {
                  ticketNumber: t.ticket_number,
                  fromStatus: 'cancelled',
                  toStatus: t.status,
                  source: 'sync_pull',
                  details: { reason: 'cloud_is_source_of_truth', hadCancelledAt: Boolean(local.cancelled_at) },
                });
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

          // Coerce every binding to a SQLite-compatible value. Supabase may omit
          // columns entirely (e.g. `cancelled_at` was dropped from the cloud schema),
          // which yields `undefined` — better-sqlite3 throws on undefined bindings and
          // that would abort the whole transaction, silently losing every ticket in the
          // batch and causing Station's waiting count to drift from the cloud.
          upsert.run(
            t.id ?? null,
            t.ticket_number ?? null,
            t.office_id ?? null,
            t.department_id ?? null,
            t.service_id ?? null,
            t.desk_id ?? null,
            t.status ?? null,
            t.priority ?? 0,
            typeof t.customer_data === 'string' ? t.customer_data : JSON.stringify(t.customer_data ?? {}),
            t.created_at ?? null,
            t.called_at ?? null,
            t.called_by_staff_id ?? null,
            t.serving_started_at ?? null,
            t.completed_at ?? null,
            t.cancelled_at ?? null,
            t.parked_at ?? null,
            t.recall_count ?? 0,
            t.notes ?? null,
            t.is_remote ? 1 : 0,
            t.appointment_id ?? null,
            t.source ?? 'walk_in',
            new Date().toISOString(),
            // delivery_address arrives from PostgREST as a parsed JSON object
            // for JSONB columns. We store it as TEXT locally for portability.
            t.delivery_address == null
              ? null
              : (typeof t.delivery_address === 'string' ? t.delivery_address : JSON.stringify(t.delivery_address)),
            t.assigned_rider_id ?? null,
            t.dispatched_at ?? null,
            t.delivered_at ?? null,
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
            logger.warn('sync.pullLatest', 'Ticket fetch failed', { status: r.status, officeId, body: body.slice(0, 200) });
            return null;
          }
          return r.json() as Promise<any[]>;
        };

        // 1. Active tickets — always pull ALL active tickets (no incremental cursor)
        // The tickets table has no updated_at column, and active ticket count is small enough
        // Include `pending_approval` so the Station receives online orders
        // awaiting Accept/Decline. Without this they'd only show up after
        // someone refreshed the cloud-truth side.
        const activeUrl = `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${officeId}&status=in.(waiting,called,serving,pending_approval)&order=created_at.asc`;
        let activeTickets = await fetchTickets(headers, activeUrl);
        if (activeTickets === null) {
          // Token expired — force refresh (bypass cache) and retry once
          logger.info('sync.pullLatest', 'Token expired, forcing refresh...');
          this.cachedAccessToken = null;
          const newToken = await this.refreshAccessToken();
          if (newToken) {
            headers.Authorization = `Bearer ${newToken}`;
            logger.info('sync.pullLatest', 'Token refreshed, retrying...');
            activeTickets = await fetchTickets(headers, activeUrl);
          }
          // If still null, try anon key as last resort (read-only but better than nothing)
          if (activeTickets === null) {
            logger.info('sync.pullLatest', 'Trying anon key as fallback...');
            const anonHeaders = { apikey: this.supabaseKey, Authorization: `Bearer ${this.supabaseKey}` };
            activeTickets = await fetchTickets(anonHeaders, activeUrl);
          }
        }

        if (activeTickets !== null) {
          logger.info('sync.pullLatest', 'Upserting active tickets', { count: activeTickets.length, locallyModifiedCount: locallyModifiedIds.size, tickets: activeTickets.map((t:any) => `${t.ticket_number}(${t.status})`).join(', ') });
          upsertBatch(activeTickets);
          logger.info('sync.pullLatest', 'Active tickets pulled for office', { officeId, total: activeTickets.length, waiting: activeTickets.filter((t: any) => t.status === 'waiting').length });
        } else {
          logger.warn('sync.pullLatest', 'Could not fetch active tickets for office', { officeId });
          continue; // skip this office, try the next one
        }

        // 2. Recent historical tickets — date-filtered (last 48h, avoids clock-drift issues)
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const histUrl = `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${officeId}&status=in.(served,no_show,cancelled)&created_at=gte.${cutoff}&order=created_at.asc`;
        let histTickets = await fetchTickets(headers, histUrl);
        if (histTickets !== null) {
          upsertBatch(histTickets);

          // ── PROACTIVE GHOST SWEEP ──
          // Any ticket that pulled back in a terminal state (served / no_show /
          // cancelled) cannot accept further status transitions. If sync_queue
          // still has pending UPDATEs targeting non-terminal statuses for these
          // tickets, they are guaranteed ghosts — discard them now instead of
          // letting them retry 12 cycles. This kills the most common ghost
          // source: realtime/cloud advanced past us before our local intent
          // had a chance to push.
          if (histTickets.length > 0) {
            const terminalIds = histTickets.map((t: any) => t.id);
            const placeholders = terminalIds.map(() => '?').join(',');
            const sweep = this.db.prepare(
              `UPDATE sync_queue
               SET synced_at = ?, last_error = 'GHOST_SWEEP: cloud row in terminal state at pull time'
               WHERE synced_at IS NULL
                 AND table_name = 'tickets'
                 AND operation IN ('UPDATE','CALL')
                 AND record_id IN (${placeholders})
                 AND json_extract(payload, '$.status') IN ('called','serving','waiting')`
            );
            const result = sweep.run(new Date().toISOString(), ...terminalIds);
            if (result.changes > 0) {
              logger.info('sync.pullLatest', 'Ghost sweep — discarded stale UPDATEs to terminal-state tickets', { discarded: result.changes });
              this.updatePendingCount();
            }
          }
        }

        // ── AUTHORITATIVE MIRROR: local active set MUST equal cloud active set ──
        // Rule (requested by product): the business queue must ALWAYS match the customer
        // queue (WhatsApp, Messenger, tracking page, public displays). Those channels query
        // Supabase directly, so Supabase is the single source of truth. After every pull we
        // align the local SQLite active set to the cloud active set — no heuristics, no
        // auto-cancel ghosts. Any local active row not in cloud is either:
        //   (a) resolved in cloud → adopt cloud history state
        //   (b) truly gone from cloud → DELETE the local row (clean mirror, no zombies)
        // Rows protected from mirroring: pending local sync, offline-created, <2min old.
        //
        // Cloud-active rows missing locally (or stored as cancelled/served locally with no
        // pending sync) are already resurrected by upsertBatch's "cloud overrides local"
        // branch above — so after this block the Station's waiting list exactly mirrors
        // what WhatsApp /status and the display boards see.
        //
        // MULTI-PC SAFETY: If cloud returned 0 active tickets but we have local active
        // tickets, this likely means the auth token was dead and RLS returned empty results.
        // Skip the mirror to avoid wiping valid local data.
        const localActiveCount = (this.db.prepare(
          "SELECT count(*) as cnt FROM tickets WHERE office_id = ? AND status IN ('waiting','called','serving')"
        ).get(officeId) as any)?.cnt ?? 0;
        const skipMirror = activeTickets !== null && activeTickets.length === 0 && localActiveCount > 0;
        if (skipMirror) {
          logger.warn('sync.mirror', 'Skipping mirror — cloud returned 0 but local has active tickets (possible auth issue)', { officeId, localActiveCount });
        }
        if (activeTickets !== null && !skipMirror) {
          const cloudActiveIds = new Set(activeTickets.map((t: any) => t.id));
          const localActive = this.db.prepare(
            "SELECT id, ticket_number, status, is_offline, created_at FROM tickets WHERE office_id = ? AND status IN ('waiting','called','serving')"
          ).all(officeId) as any[];

          for (const local of localActive) {
            if (cloudActiveIds.has(local.id)) continue; // still active in cloud — already upserted
            if (locallyModifiedIds.has(local.id)) continue; // pending local change — don't overwrite
            if (local.is_offline) continue; // offline-created, not yet pushed — keep it

            // Grace window: never mutate tickets created in the last 2 minutes
            // (covers INSERT → first successful push race)
            if (local.created_at) {
              const ageMs = Date.now() - new Date(local.created_at).getTime();
              if (ageMs < 120_000) {
                logger.info('sync.mirror', 'Skipping ticket — too recent', { ticketNumber: local.ticket_number, ageSeconds: Math.round(ageMs / 1000) });
                continue;
              }
            }

            const inHistory = (histTickets ?? []).find((t: any) => t.id === local.id);
            if (inHistory) {
              // Cloud has it as served/cancelled/no_show — upsertBatch already adopted that.
              // Nothing to do here; this branch is a no-op kept for observability.
              continue;
            }

            // Truly absent from cloud (active AND 48h history). Delete locally so the
            // Station's count and position list mirror cloud exactly. We do NOT mark
            // it 'cancelled' — that would leave a ghost row the upsert path could not
            // cleanly distinguish from an operator cancel on next pull.
            logger.info('sync.mirror', 'Removing ticket absent from cloud', { ticketNumber: local.ticket_number, localStatus: local.status });
            logTicketEvent(local.id, 'mirror_removed', {
              ticketNumber: local.ticket_number,
              fromStatus: local.status,
              toStatus: 'deleted',
              source: 'sync_mirror',
              details: { reason: 'not_found_in_cloud', wasOffline: Boolean(local.is_offline) },
            });
            this.db.prepare("DELETE FROM tickets WHERE id = ?").run(local.id);
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
            logger.info('sync.cleanup', 'Removing local L-prefix ticket — cloud has real number', { localNumber: localL.ticket_number, cloudNumber: t.ticket_number });
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
      logger.error('sync.pullLatest', 'Pull error', { error: err?.message ?? err });
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

      logger.info('sync.reconcile', 'Found tickets with L- prefix after sync — fixing...', { count: orphans.length });
      for (const ticket of orphans) {
        await this.rewriteOfflineTicket(ticket.id);
      }
    } catch (err: any) {
      logger.warn('sync.reconcile', 'L-prefix reconciliation error', { error: err?.message });
    }
  }

  /**
   * Recover stuck sync items: reset items that have been stuck for > 30 min
   * with retriable errors (network timeouts, 5xx). Caps at 10 total attempts.
   */
  /**
   * Snapshot of sync health for the UI.
   * - circuitOpen: push pipeline is paused due to consecutive failures
   * - authExpired: at least one pending item is flagged AUTH_EXPIRED
   * - oldestPendingAgeMs: age of the oldest un-synced row, in ms (null if none)
   *
   * The UI uses these to show a red banner with a clear CTA when sync is
   * compromised, rather than silently piling up rows in the Pending panel.
   */
  public getHealth(): { circuitOpen: boolean; authExpired: boolean; oldestPendingAgeMs: number | null } {
    let authExpired = false;
    let oldestPendingAgeMs: number | null = null;
    try {
      const authRow = this.db.prepare(
        "SELECT 1 FROM sync_queue WHERE synced_at IS NULL AND last_error LIKE 'AUTH_EXPIRED%' LIMIT 1"
      ).get() as any;
      authExpired = !!authRow;
      const oldest = this.db.prepare(
        "SELECT MIN(created_at) as oldest FROM sync_queue WHERE synced_at IS NULL"
      ).get() as any;
      if (oldest?.oldest) {
        oldestPendingAgeMs = Date.now() - new Date(oldest.oldest).getTime();
      }
    } catch {
      /* SQLite failure — return defaults */
    }
    return { circuitOpen: this.circuitOpen, authExpired, oldestPendingAgeMs };
  }

  private recoverStuckItems() {
    // ── WATCHDOG: force-promote attempts=0 rows older than 30s ──────
    // Structural guarantee: no sync_queue row can ever sit at attempts=0
    // for longer than 30 seconds. If an item is still at 0 attempts after
    // 30s, it means nothing ever tried to push it (pushImmediate didn't
    // fire, loop was interrupted, notifier wasn't registered, etc.).
    // Clear next_retry_at so it's picked up by the next syncNow() cycle,
    // and kick one off right away.
    const thirtySecAgo = new Date(Date.now() - 30 * 1000).toISOString();
    const watchdogCount = this.db.prepare(
      `SELECT COUNT(*) as c FROM sync_queue
        WHERE synced_at IS NULL AND attempts = 0 AND created_at < ?`
    ).get(thirtySecAgo) as any;
    if (watchdogCount?.c > 0) {
      this.db.prepare(
        `UPDATE sync_queue SET next_retry_at = NULL, last_error = 'watchdog:promoted'
         WHERE synced_at IS NULL AND attempts = 0 AND created_at < ?`
      ).run(thirtySecAgo);
      logger.warn('sync.watchdog', 'Force-promoted rows stuck at attempts=0 for >30s', { count: watchdogCount.c });
      this.updatePendingCount();
      // Kick a sync immediately — don't wait for the next batch tick.
      if (this.isOnline) void this.syncNow();
    }

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
      logger.info('sync.recover', 'Reset stuck items for retry', { count: recovered.changes });
    }

    // Critical items (called/serving/cancelled/served/no_show) and INSERTs that have
    // been stuck for > 30 min with ANY error get their next_retry_at cleared so they
    // are immediately eligible for the next syncNow() cycle.
    const criticalRecovered = this.db.prepare(`
      UPDATE sync_queue
      SET next_retry_at = NULL
      WHERE synced_at IS NULL
        AND attempts >= 10
        AND created_at < ?
        AND (
          operation = 'INSERT'
          OR json_extract(payload, '$.status') IN ('called','serving','cancelled','served','no_show')
        )
    `).run(thirtyMinAgo);
    if (criticalRecovered.changes > 0) {
      logger.info('sync.recover', 'Unblocked critical items stuck at 10+ attempts', { count: criticalRecovered.changes });
    }
  }

  /**
   * Active reconciliation: query cloud truth for stuck queue rows and
   * resolve them. This is the self-healing pass — it complements
   * recoverStuckItems (which only resets retry timers) by actually
   * verifying against Supabase whether further retries are pointless.
   *
   * Targets: tickets UPDATE/CALL rows with attempts >= 3 and >60s old.
   * For each, checks the cloud row's current status:
   *   - row missing → discard (orphan; INSERT was lost)
   *   - cloud at/past queued status → discard (already realized or superseded)
   *   - cloud at expected prior state → leave alone (genuine retry)
   * Runs at most once every 5 minutes (rate-limited by lastReconcileAt).
   */
  private async reconcileStuckSyncItems() {
    if (!this.isOnline) return;

    // Pull stuck ticket UPDATEs. Only critical-status payloads — non-critical
    // UPDATEs already auto-discard at attempts=10, but critical ones are
    // immortal and need active resolution.
    const sixtySecAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const stuck = this.db.prepare(
      `SELECT id, record_id, payload, attempts, last_error
         FROM sync_queue
        WHERE synced_at IS NULL
          AND table_name = 'tickets'
          AND operation IN ('UPDATE','CALL')
          AND attempts >= 3
          AND created_at < ?
          AND json_extract(payload, '$.status') IN ('called','serving','cancelled','served','no_show')
        LIMIT 50`
    ).all(sixtySecAgo) as Array<{ id: string; record_id: string; payload: string; attempts: number; last_error: string | null }>;

    if (stuck.length === 0) return;

    // Get a fresh token. If we can't, skip this pass — recover next cycle.
    let token: string;
    try {
      token = await this.ensureFreshToken();
    } catch {
      return;
    }

    // Batch the cloud lookup: one PostgREST query for up to 50 ticket ids.
    const idList = Array.from(new Set(stuck.map((s) => s.record_id)));
    const url = `${this.supabaseUrl}/rest/v1/tickets?id=in.(${idList.join(',')})&select=id,status`;

    let cloudRows: Array<{ id: string; status: string }> = [];
    try {
      const res = await fetch(url, {
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn('sync.reconcile', 'Lookup failed', { status: res.status });
        return;
      }
      cloudRows = await res.json().catch(() => []);
    } catch (err: any) {
      logger.warn('sync.reconcile', 'Lookup network error', { error: err?.message });
      return;
    }

    const cloudById = new Map(cloudRows.map((r) => [r.id, r.status]));
    const rank: Record<string, number> = {
      waiting: 0, called: 1, serving: 2, served: 3, no_show: 3, cancelled: 3, transferred: 3,
    };
    const terminal = new Set(['served', 'cancelled', 'no_show', 'transferred']);

    let discarded = 0;
    const now = new Date().toISOString();
    const markGhost = this.db.prepare(
      `UPDATE sync_queue SET synced_at = ?, last_error = ? WHERE id = ? AND synced_at IS NULL`
    );

    for (const item of stuck) {
      let payload: { status?: string };
      try { payload = JSON.parse(item.payload); } catch { continue; }
      const targetStatus = payload.status;
      if (!targetStatus) continue;

      const cloudStatus = cloudById.get(item.record_id);

      // Row missing in cloud — orphan. The INSERT must have failed and been
      // discarded; this UPDATE has nothing to point at, ever.
      if (cloudStatus === undefined) {
        markGhost.run(now, `RECONCILE_GHOST: cloud row missing after ${item.attempts} attempts`, item.id);
        discarded++;
        continue;
      }

      // Cloud already terminal — our intent can never apply.
      if (terminal.has(cloudStatus)) {
        markGhost.run(now, `RECONCILE_GHOST: cloud terminal (${cloudStatus}) ≠ target ${targetStatus}`, item.id);
        discarded++;
        continue;
      }

      // Cloud already at or past our target status — duplicate or superseded.
      const cloudRank = rank[cloudStatus] ?? 0;
      const targetRank = rank[targetStatus] ?? 0;
      if (cloudRank >= targetRank) {
        markGhost.run(now, `RECONCILE_GHOST: cloud ${cloudStatus} ≥ target ${targetStatus}`, item.id);
        discarded++;
        continue;
      }

      // Otherwise: cloud is at the expected prior state. Genuine retry —
      // leave it alone; next syncNow cycle will try again with a fresh token.
    }

    if (discarded > 0) {
      logger.info('sync.reconcile', 'Discarded ghost queue rows after cloud verification', {
        discarded,
        examined: stuck.length,
      });
      this.updatePendingCount();
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
      SELECT id, ticket_number, desk_id, called_at FROM tickets
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

      logger.warn('sync.staleCalled', 'AUTO-REVERT stale called ticket', {
        ticketId: t.id,
        ticketNumber: t.ticket_number,
        previousDesk: t.desk_id,
        calledAt: t.called_at ?? 'unknown',
        revertedAt: now,
        newStatus: 'waiting',
        reason: 'called_30min_no_action',
      });

      logTicketEvent(t.id, 'stale_called_auto_revert', {
        ticketNumber: t.ticket_number,
        fromStatus: 'called',
        toStatus: 'waiting',
        source: 'station',
        details: { reason: 'stale_called_auto_revert', previousDesk: t.desk_id, calledAt: t.called_at },
      });

      // Queue sync so cloud also gets the revert
      enqueueSync({
        id: `${t.id}-stale-revert-${Date.now()}`,
        operation: 'UPDATE',
        table: 'tickets',
        recordId: t.id,
        payload: { status: 'waiting', desk_id: null, called_at: null, called_by_staff_id: null },
        createdAt: now,
      });
    }

    logger.warn('sync.staleCalled', 'Reverted tickets called 30+ min ago back to waiting', { count: stale.length });
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
          logger.info('sync.autoResolve', 'Resolved stale tickets', { total, ...result });
          // Pull fresh data since tickets changed
          await this.pullLatest();
        }
      }
    } catch (err: any) {
      // Non-critical — cron on Supabase handles this too
      logger.info('sync.autoResolve', 'Skipped', { error: err?.message ?? err });
    }
  }
}
