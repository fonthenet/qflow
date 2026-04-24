import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

// Mock electron safeStorage
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
  },
}));

// Mock db module exports used by SyncEngine
vi.mock('../db', () => ({
  logTicketEvent: vi.fn(),
  setSyncNotifier: vi.fn(),
  enqueueSync: vi.fn(),
  deriveOrgIdForSyncItem: vi.fn(),
}));

// Import after mocks are set up
import { SyncEngine } from '../sync';

// ── Helpers ────────────────────────────────────────────────────────

/** Create a minimal valid JWT with a given expiry timestamp (seconds) */
function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, sub: 'user-1' })).toString('base64');
  return `${header}.${payload}.fakesig`;
}

/** A JWT that expires far in the future */
const VALID_TOKEN = makeJwt(Math.floor(Date.now() / 1000) + 3600);

/** A JWT that is already expired */
const EXPIRED_TOKEN = makeJwt(Math.floor(Date.now() / 1000) - 3600);

/** Seed a session with a valid access_token + refresh_token + office_ids */
function seedSession(db: Database.Database, opts: { accessToken?: string; refreshToken?: string; officeIds?: string[] } = {}) {
  const session = {
    access_token: opts.accessToken ?? VALID_TOKEN,
    refresh_token: opts.refreshToken ?? 'rt-test',
    office_ids: opts.officeIds ?? ['office-1'],
  };
  db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('current', ?)").run(JSON.stringify(session));
}

/** Insert a pending sync_queue item */
function insertSyncItem(db: Database.Database, overrides: Partial<{
  id: string; operation: string; table_name: string; record_id: string;
  payload: string; created_at: string; attempts: number; last_error: string | null;
  synced_at: string | null; next_retry_at: string | null;
}> = {}) {
  const defaults = {
    id: 'sq-' + Math.random().toString(36).slice(2, 8),
    operation: 'UPDATE',
    table_name: 'tickets',
    record_id: 'ticket-1',
    payload: JSON.stringify({ status: 'called', ticket_number: 'CS-001' }),
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    synced_at: null,
    next_retry_at: null,
  };
  const item = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts, last_error, synced_at, next_retry_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(item.id, item.operation, item.table_name, item.record_id, item.payload,
    item.created_at, item.attempts, item.last_error, item.synced_at, item.next_retry_at);
  return item;
}

/** Create a SyncEngine with spy callbacks */
function createEngine(db: Database.Database) {
  const callbacks = {
    onStatus: vi.fn(),
    onProgress: vi.fn(),
    onAuthError: vi.fn(),
    onDataPulled: vi.fn(),
    onTicketError: vi.fn(),
  };
  const engine = new SyncEngine(
    db,
    'https://test.supabase.co',
    'test-anon-key',
    callbacks.onStatus,
    callbacks.onProgress,
    callbacks.onAuthError,
    callbacks.onDataPulled,
    callbacks.onTicketError,
  );
  return { engine, callbacks };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SyncEngine', () => {
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createTestDB();
    // Add columns/tables that pullLatest needs but createTestDB doesn't include
    try { db.exec(`ALTER TABLE desks ADD COLUMN display_name TEXT`); } catch { /* */ }
    try { db.exec(`ALTER TABLE desks ADD COLUMN status TEXT DEFAULT 'open'`); } catch { /* */ }
    try { db.exec(`ALTER TABLE tickets ADD COLUMN source TEXT DEFAULT 'walk_in'`); } catch { /* */ }
    try { db.exec(`ALTER TABLE tickets ADD COLUMN daily_sequence INTEGER`); } catch { /* */ }
    try { db.exec(`ALTER TABLE tickets ADD COLUMN qr_token TEXT`); } catch { /* */ }
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS office_holidays (
        id TEXT PRIMARY KEY,
        office_id TEXT NOT NULL,
        holiday_date TEXT NOT NULL,
        name TEXT,
        is_full_day INTEGER DEFAULT 1,
        open_time TEXT,
        close_time TEXT
      )`);
    } catch { /* */ }
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS ticket_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch { /* */ }
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Push sync ────────────────────────────────────────────────────

  describe('Push sync (syncNow)', () => {
    it('successful push marks items as synced', async () => {
      seedSession(db);
      const item = insertSyncItem(db, {
        id: 'sq-1',
        operation: 'UPDATE',
        record_id: 'ticket-1',
        payload: JSON.stringify({ status: 'called' }),
      });

      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      // Mock fetch: token refresh (may be called) + PATCH success
      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt-new' }) };
        }
        // PATCH for UPDATE operation
        if (opts?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => [{ id: 'ticket-1' }] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      await engine.syncNow();

      // Verify item is now synced
      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-1'").get() as any;
      expect(row.synced_at).not.toBeNull();
      expect(row.last_error).toBeNull();
    });

    it('multiple pending items are processed in order', async () => {
      seedSession(db);
      insertSyncItem(db, { id: 'sq-1', created_at: '2026-01-01T00:00:00Z', payload: JSON.stringify({ status: 'called' }) });
      insertSyncItem(db, { id: 'sq-2', created_at: '2026-01-01T00:01:00Z', payload: JSON.stringify({ status: 'serving' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      const patchedIds: string[] = [];
      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        if (opts?.method === 'PATCH') {
          // Extract record_id from URL
          const match = url.match(/id=eq\.([^&]+)/);
          if (match) patchedIds.push(match[1]);
          return { ok: true, status: 200, json: async () => [{ id: match?.[1] }] };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      const remaining = db.prepare("SELECT * FROM sync_queue WHERE synced_at IS NULL").all();
      expect(remaining).toHaveLength(0);
    });

    it('network error increments attempts and sets exponential backoff', async () => {
      seedSession(db);
      insertSyncItem(db, { id: 'sq-1', attempts: 0, payload: JSON.stringify({ status: 'called' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        throw new Error('Network error: ECONNREFUSED');
      });

      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-1'").get() as any;
      expect(row.synced_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain('Network error');
      expect(row.next_retry_at).not.toBeNull();
    });

    it('4xx non-auth error throws and increments attempts (not treated as 401)', async () => {
      seedSession(db);
      insertSyncItem(db, { id: 'sq-1', attempts: 0, payload: JSON.stringify({ status: 'called' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        // Return a 400 Bad Request (not 401/403)
        return { ok: false, status: 400, json: async () => ([]), text: async () => 'Bad Request' };
      });

      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-1'").get() as any;
      expect(row.synced_at).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain('UPDATE failed: 400');
    });

    it('skips sync when offline', async () => {
      seedSession(db);
      insertSyncItem(db, { id: 'sq-1' });

      const { engine } = createEngine(db);
      engine.isOnline = false;

      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-1'").get() as any;
      expect(row.synced_at).toBeNull();
      expect(row.attempts).toBe(0);
      // fetch should not have been called
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── Token refresh / 401 handling ─────────────────────────────────

  describe('Token refresh (401 handling)', () => {
    it('handles 401 by refreshing token and retrying the item', async () => {
      seedSession(db, { accessToken: EXPIRED_TOKEN });
      insertSyncItem(db, { id: 'sq-1', payload: JSON.stringify({ status: 'called' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      let patchCallCount = 0;
      fetchMock.mockImplementation(async (url: string, opts: any) => {
        // ensureFreshToken may try to refresh
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt-new' }) };
        }
        if (opts?.method === 'PATCH') {
          patchCallCount++;
          if (patchCallCount === 1) {
            // First PATCH returns 401
            return { ok: false, status: 401, json: async () => ([]) };
          }
          // Retry after token refresh succeeds
          return { ok: true, status: 200, json: async () => [{ id: 'ticket-1' }] };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-1'").get() as any;
      expect(row.synced_at).not.toBeNull();
    });

    it('fires onAuthError after consecutive refresh failures (5 failures)', async () => {
      seedSession(db, { accessToken: EXPIRED_TOKEN });
      insertSyncItem(db, { id: 'sq-1', payload: JSON.stringify({ status: 'called' }) });

      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        // All token refreshes fail
        if (url.includes('/auth/v1/token')) {
          return { ok: false, status: 401, text: async () => 'Invalid refresh token' };
        }
        if (opts?.method === 'PATCH') {
          return { ok: false, status: 401, json: async () => ([]) };
        }
        return { ok: true, json: async () => ({}) };
      });

      // Run syncNow multiple times to accumulate failures
      // Each call tries refresh which fails, incrementing consecutiveRefreshFailures
      for (let i = 0; i < 5; i++) {
        // Re-insert the item each time since it may get flagged
        db.prepare("UPDATE sync_queue SET synced_at = NULL, last_error = NULL WHERE id = 'sq-1'").run();
        await engine.syncNow();
      }

      // After 5 consecutive refresh failures, onAuthError should have been called
      expect(callbacks.onAuthError).toHaveBeenCalled();
    });

    it('flags remaining items as AUTH_EXPIRED when token refresh fails during sync', async () => {
      seedSession(db, { accessToken: EXPIRED_TOKEN });
      insertSyncItem(db, { id: 'sq-1', payload: JSON.stringify({ status: 'called' }) });
      insertSyncItem(db, { id: 'sq-2', payload: JSON.stringify({ status: 'serving' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: false, status: 401, text: async () => 'expired' };
        }
        if (opts?.method === 'PATCH') {
          return { ok: false, status: 401, json: async () => ([]) };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      // All unsynced items should be flagged with AUTH_EXPIRED
      const items = db.prepare("SELECT * FROM sync_queue WHERE synced_at IS NULL").all() as any[];
      for (const item of items) {
        expect(item.last_error).toContain('AUTH_EXPIRED');
      }
    });

    it('suppressAuthErrors prevents onAuthError for the specified duration', async () => {
      seedSession(db, { accessToken: EXPIRED_TOKEN });
      insertSyncItem(db, { id: 'sq-1', payload: JSON.stringify({ status: 'called' }) });

      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      // Suppress auth errors for 30 seconds
      engine.suppressAuthErrors(30000);

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: false, status: 401, text: async () => 'expired' };
        }
        if (opts?.method === 'PATCH') {
          return { ok: false, status: 401, json: async () => ([]) };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      // onAuthError should NOT be called because we suppressed it
      expect(callbacks.onAuthError).not.toHaveBeenCalled();
    });
  });

  // ── Circuit breaker ──────────────────────────────────────────────

  describe('Circuit breaker', () => {
    it('opens after 5 consecutive push failures', async () => {
      seedSession(db);
      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        // All PATCHes fail with 500
        throw new Error('Server error: 500');
      });

      // Insert and run 5 items that all fail (each pushes the circuit breaker count)
      for (let i = 0; i < 5; i++) {
        insertSyncItem(db, {
          id: `sq-${i}`,
          record_id: `ticket-${i}`,
          payload: JSON.stringify({ status: 'waiting' }),
        });
      }

      await engine.syncNow();

      // onTicketError should have been called with circuit_breaker_open
      expect(callbacks.onTicketError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'circuit_breaker_open' })
      );
    });

    it('blocks sync while circuit is open', async () => {
      seedSession(db);
      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        throw new Error('Server error');
      });

      // Trip the circuit breaker by running 5+ failures
      for (let i = 0; i < 6; i++) {
        insertSyncItem(db, {
          id: `sq-trip-${i}`,
          record_id: `ticket-trip-${i}`,
          payload: JSON.stringify({ status: 'waiting' }),
        });
      }
      await engine.syncNow();

      // Reset fetch mock to track new calls
      fetchMock.mockClear();

      // Insert a new item and try to sync — should be blocked
      insertSyncItem(db, { id: 'sq-blocked', payload: JSON.stringify({ status: 'called' }) });
      await engine.syncNow();

      // fetch should NOT have been called because circuit is open
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows sync after cooldown expires (half-open)', async () => {
      seedSession(db);
      const { engine } = createEngine(db);
      engine.isOnline = true;

      let callCount = 0;
      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        callCount++;
        if (callCount <= 5) throw new Error('Server error');
        // After cooldown, server recovers
        if (opts?.method === 'PATCH') {
          return { ok: true, status: 200, json: async () => [{ id: 'ticket-1' }] };
        }
        return { ok: true, json: async () => ({}) };
      });

      // Trip the breaker
      for (let i = 0; i < 6; i++) {
        insertSyncItem(db, {
          id: `sq-trip2-${i}`,
          record_id: `ticket-trip2-${i}`,
          payload: JSON.stringify({ status: 'waiting' }),
        });
      }
      await engine.syncNow();

      // Advance time past the cooldown (60 seconds)
      vi.advanceTimersByTime(61_000);

      // Insert a new item and sync — should work now (half-open)
      insertSyncItem(db, {
        id: 'sq-recovery',
        record_id: 'ticket-recovery',
        payload: JSON.stringify({ status: 'called' }),
      });
      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-recovery'").get() as any;
      expect(row.synced_at).not.toBeNull();
    });
  });

  // ── Pull sync ────────────────────────────────────────────────────

  describe('Pull sync (pullLatest)', () => {
    it('merges cloud offices into local DB', async () => {
      seedSession(db, { officeIds: ['office-1'] });

      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        if (url.includes('/rest/v1/offices')) {
          return { ok: true, json: async () => [{ id: 'office-1', name: 'Main Office', address: '123 St', organization_id: 'org-1', settings: {}, operating_hours: {}, timezone: 'Africa/Algiers' }] };
        }
        if (url.includes('/rest/v1/departments')) {
          return { ok: true, json: async () => [{ id: 'dept-1', name: 'General', code: 'GEN', office_id: 'office-1' }] };
        }
        if (url.includes('/rest/v1/services')) {
          return { ok: true, json: async () => [{ id: 'svc-1', name: 'Consultation', department_id: 'dept-1', estimated_service_time: 15 }] };
        }
        if (url.includes('/rest/v1/desks')) {
          return { ok: true, json: async () => [{ id: 'desk-1', name: 'Desk 1', department_id: 'dept-1', office_id: 'office-1', is_active: true, current_staff_id: null }] };
        }
        if (url.includes('/rest/v1/office_holidays')) {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(waiting,called,serving)')) {
          return { ok: true, json: async () => [
            { id: 't-1', ticket_number: 'GEN-001', office_id: 'office-1', department_id: 'dept-1', service_id: 'svc-1', desk_id: null, status: 'waiting', priority: 0, customer_data: '{}', created_at: '2026-01-01T10:00:00Z', called_at: null, called_by_staff_id: null, serving_started_at: null, completed_at: null, cancelled_at: null, parked_at: null, recall_count: 0, notes: null, is_remote: false, appointment_id: null, source: 'walk_in' },
          ] };
        }
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(served,no_show,cancelled)')) {
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.pullLatest();

      // Verify office was inserted
      const office = db.prepare("SELECT * FROM offices WHERE id = 'office-1'").get() as any;
      expect(office).toBeTruthy();
      expect(office.name).toBe('Main Office');

      // Verify department was inserted
      const dept = db.prepare("SELECT * FROM departments WHERE id = 'dept-1'").get() as any;
      expect(dept).toBeTruthy();
      expect(dept.name).toBe('General');

      // Verify ticket was inserted
      const ticket = db.prepare("SELECT * FROM tickets WHERE id = 't-1'").get() as any;
      expect(ticket).toBeTruthy();
      expect(ticket.ticket_number).toBe('GEN-001');
      expect(ticket.status).toBe('waiting');
    });

    it('does not overwrite locally modified tickets (pending sync items)', async () => {
      seedSession(db, { officeIds: ['office-1'] });

      // Local ticket is 'called' with a pending sync item
      db.prepare(
        `INSERT INTO tickets (id, ticket_number, office_id, department_id, status, priority, customer_data, created_at)
         VALUES ('t-1', 'GEN-001', 'office-1', 'dept-1', 'called', 0, '{}', '2026-01-01T10:00:00Z')`
      ).run();
      insertSyncItem(db, { id: 'sq-local', operation: 'UPDATE', record_id: 't-1', payload: JSON.stringify({ status: 'called' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        if (url.includes('/rest/v1/offices')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/departments')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/services')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/desks')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/office_holidays')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(waiting,called,serving)')) {
          // Cloud says ticket is still 'waiting'
          return { ok: true, json: async () => [
            { id: 't-1', ticket_number: 'GEN-001', office_id: 'office-1', department_id: 'dept-1', service_id: null, desk_id: null, status: 'waiting', priority: 0, customer_data: '{}', created_at: '2026-01-01T10:00:00Z', called_at: null, called_by_staff_id: null, serving_started_at: null, completed_at: null, cancelled_at: null, parked_at: null, recall_count: 0, notes: null, is_remote: false, appointment_id: null, source: 'walk_in' },
          ] };
        }
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(served,no_show,cancelled)')) {
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.pullLatest();

      // Local ticket should still be 'called' (not overwritten by cloud 'waiting')
      const ticket = db.prepare("SELECT * FROM tickets WHERE id = 't-1'").get() as any;
      expect(ticket.status).toBe('called');
    });

    it('skips pull when no session or office_ids', async () => {
      // No session at all
      const { engine } = createEngine(db);
      engine.isOnline = true;

      await engine.pullLatest();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('notifies onDataPulled when ticket data changes', async () => {
      seedSession(db, { officeIds: ['office-1'] });

      const { engine, callbacks } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        if (url.includes('/rest/v1/offices')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/departments')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/services')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/desks')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/office_holidays')) return { ok: true, json: async () => [] };
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(waiting,called,serving)')) {
          return { ok: true, json: async () => [
            { id: 't-new', ticket_number: 'CS-001', office_id: 'office-1', department_id: 'd1', status: 'waiting', priority: 0, customer_data: '{}', created_at: '2026-01-01T10:00:00Z', is_remote: false, source: 'walk_in' },
          ] };
        }
        if (url.includes('/rest/v1/tickets') && url.includes('status=in.(served,no_show,cancelled)')) {
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.pullLatest();

      expect(callbacks.onDataPulled).toHaveBeenCalled();
    });
  });

  // ── ensureFreshToken ─────────────────────────────────────────────

  describe('ensureFreshToken', () => {
    it('returns cached token if not expired', async () => {
      seedSession(db, { accessToken: VALID_TOKEN });
      const { engine } = createEngine(db);

      const token = await engine.ensureFreshToken();
      expect(token).toBe(VALID_TOKEN);
      // No fetch calls needed — token came from DB
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes expired token via Supabase auth endpoint', async () => {
      const newToken = makeJwt(Math.floor(Date.now() / 1000) + 7200);
      seedSession(db, { accessToken: EXPIRED_TOKEN, refreshToken: 'rt-valid' });
      const { engine } = createEngine(db);

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: newToken, refresh_token: 'rt-new' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const token = await engine.ensureFreshToken();
      expect(token).toBe(newToken);

      // Verify session was updated in DB
      const session = JSON.parse(
        (db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any).value
      );
      expect(session.access_token).toBe(newToken);
      expect(session.refresh_token).toBe('rt-new');
    });

    it('deduplicates concurrent refresh calls', async () => {
      seedSession(db, { accessToken: EXPIRED_TOKEN });
      const { engine } = createEngine(db);

      let refreshCallCount = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          refreshCallCount++;
          // Simulate some latency
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      // Fire two concurrent ensureFreshToken calls
      const [t1, t2] = await Promise.all([
        engine.ensureFreshToken(),
        engine.ensureFreshToken(),
      ]);

      expect(t1).toBe(VALID_TOKEN);
      expect(t2).toBe(VALID_TOKEN);
      // Only one actual refresh call should have been made
      expect(refreshCallCount).toBe(1);
    });
  });

  // ── Startup recovery ─────────────────────────────────────────────

  describe('Startup recovery', () => {
    it('start() resets stuck sync items (next_retry_at) so they retry immediately', () => {
      const futureRetry = new Date(Date.now() + 300000).toISOString();
      insertSyncItem(db, { id: 'sq-stuck', attempts: 3, next_retry_at: futureRetry });

      const { engine } = createEngine(db);

      // Mock timers so start() intervals don't fire
      // We just care about the synchronous startup recovery
      fetchMock.mockImplementation(async () => ({ ok: false, status: 500 }));

      engine.start();
      engine.stop(); // immediately stop intervals

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-stuck'").get() as any;
      expect(row.next_retry_at).toBeNull();
    });
  });

  // ── Auto-discard rules ───────────────────────────────────────────

  describe('Auto-discard rules in syncNow', () => {
    it('discards non-critical items after 3 attempts but keeps INSERT and critical status items', async () => {
      seedSession(db);
      const { engine } = createEngine(db);
      engine.isOnline = true;

      // Insert items with attempts >= 3
      // Non-critical UPDATE (should be discarded)
      insertSyncItem(db, {
        id: 'sq-discard',
        operation: 'UPDATE',
        payload: JSON.stringify({ status: 'waiting', recall_count: 5 }),
        attempts: 3,
        synced_at: null,
      });
      // Critical UPDATE (should be kept — status is 'cancelled')
      insertSyncItem(db, {
        id: 'sq-keep-critical',
        operation: 'UPDATE',
        payload: JSON.stringify({ status: 'cancelled' }),
        attempts: 5,
        synced_at: null,
      });
      // INSERT (should be kept — INSERTs are immortal)
      insertSyncItem(db, {
        id: 'sq-keep-insert',
        operation: 'INSERT',
        payload: JSON.stringify({ status: 'waiting' }),
        attempts: 10,
        synced_at: null,
      });

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        // All mutations fail
        throw new Error('Server error');
      });

      await engine.syncNow();

      const remaining = db.prepare("SELECT id FROM sync_queue WHERE synced_at IS NULL").all() as any[];
      const remainingIds = remaining.map((r: any) => r.id);

      // The non-critical item with 3+ attempts was discarded
      expect(remainingIds).not.toContain('sq-discard');
      // Critical and INSERT items survive
      expect(remainingIds).toContain('sq-keep-critical');
      expect(remainingIds).toContain('sq-keep-insert');
    });
  });

  // ── isTokenExpired (via ensureFreshToken behavior) ────────────────

  describe('Token expiry detection', () => {
    it('treats a token expiring within 60s as expired', async () => {
      // Token that expires in 30 seconds (within the 60s buffer)
      const almostExpired = makeJwt(Math.floor(Date.now() / 1000) + 30);
      seedSession(db, { accessToken: almostExpired });
      const { engine } = createEngine(db);

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const token = await engine.ensureFreshToken();
      // Should have refreshed since the token is within the 60s buffer
      expect(token).toBe(VALID_TOKEN);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('treats malformed JWT as expired', async () => {
      seedSession(db, { accessToken: 'not-a-jwt' });
      const { engine } = createEngine(db);

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) {
          return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const token = await engine.ensureFreshToken();
      expect(token).toBe(VALID_TOKEN);
    });
  });

  // ── Reliability regression tests ─────────────────────────────────
  // These cover the specific failure modes that caused "Attempts: 0"
  // stuck items in production.

  describe('Reliability: 401 mid-batch must not stall the batch', () => {
    it('one 401 does not prevent following items from being processed', async () => {
      seedSession(db);
      // Three items in order. The first returns 401 on both tries.
      insertSyncItem(db, { id: 'sq-401', created_at: '2026-01-01T00:00:00Z', record_id: 'ticket-A', payload: JSON.stringify({ status: 'called' }) });
      insertSyncItem(db, { id: 'sq-ok-1', created_at: '2026-01-01T00:01:00Z', table_name: 'ticket_events', operation: 'INSERT', record_id: 'evt-1', payload: JSON.stringify({ event_type: 'called' }) });
      insertSyncItem(db, { id: 'sq-ok-2', created_at: '2026-01-01T00:02:00Z', table_name: 'ticket_events', operation: 'INSERT', record_id: 'evt-2', payload: JSON.stringify({ event_type: 'created' }) });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/auth/v1/token')) {
          // token refresh fails — still return 401 on the ticket
          return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
        }
        if (url.includes('/rest/v1/tickets')) {
          return { ok: false, status: 401, json: async () => ({}) };
        }
        if (url.includes('/rest/v1/ticket_events')) {
          return { ok: true, status: 201, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      // The 401 item is flagged but NOT synced
      const t = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-401'").get() as any;
      expect(t.synced_at).toBeNull();
      expect(t.last_error).toMatch(/AUTH_EXPIRED/);

      // The two ticket_events AFTER the 401 must have been processed
      const e1 = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-ok-1'").get() as any;
      const e2 = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-ok-2'").get() as any;
      expect(e1.synced_at).not.toBeNull();
      expect(e2.synced_at).not.toBeNull();
    });
  });

  describe('Reliability: watchdog promotes attempts=0 items', () => {
    it('row older than 30s at attempts=0 gets processed on the next syncNow', async () => {
      seedSession(db);
      // Insert an item that was enqueued 60 seconds ago but never tried
      const oldTs = new Date(Date.now() - 60_000).toISOString();
      insertSyncItem(db, {
        id: 'sq-stuck',
        operation: 'INSERT',
        table_name: 'ticket_events',
        record_id: 'evt-stuck',
        payload: JSON.stringify({ event_type: 'called' }),
        created_at: oldTs,
        attempts: 0,
        // Simulate: some code path somehow set next_retry_at in the future
        next_retry_at: new Date(Date.now() + 300_000).toISOString(),
      });

      const { engine } = createEngine(db);
      engine.isOnline = true;

      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/token')) return { ok: true, json: async () => ({ access_token: VALID_TOKEN, refresh_token: 'rt' }) };
        if (url.includes('/rest/v1/ticket_events')) return { ok: true, status: 201, json: async () => ({}) };
        return { ok: true, json: async () => ({}) };
      });

      await engine.syncNow();

      const row = db.prepare("SELECT * FROM sync_queue WHERE id = 'sq-stuck'").get() as any;
      // Watchdog must have cleared next_retry_at AND the item must have synced
      expect(row.synced_at).not.toBeNull();
    });
  });

  describe('Reliability: getHealth snapshot', () => {
    it('reports circuit state, auth-expired presence, and oldest pending age', () => {
      insertSyncItem(db, { id: 'sq-old', created_at: new Date(Date.now() - 120_000).toISOString() });
      insertSyncItem(db, { id: 'sq-auth', last_error: 'AUTH_EXPIRED: re-login required' });

      const { engine } = createEngine(db);
      const h = engine.getHealth();
      expect(h.authExpired).toBe(true);
      expect(h.oldestPendingAgeMs).not.toBeNull();
      expect(h.oldestPendingAgeMs!).toBeGreaterThan(100_000);
      expect(h.circuitOpen).toBe(false);
    });
  });

  // ── Pending count tracking ───────────────────────────────────────

  describe('Pending count tracking', () => {
    it('updatePendingCount reflects unsynced items', () => {
      const { engine, callbacks } = createEngine(db);

      insertSyncItem(db, { id: 'sq-1' });
      insertSyncItem(db, { id: 'sq-2' });
      insertSyncItem(db, { id: 'sq-3', synced_at: new Date().toISOString() }); // already synced

      engine.updatePendingCount();

      expect(engine.pendingCount).toBe(2);
      expect(callbacks.onProgress).toHaveBeenCalledWith(2);
    });
  });
});
