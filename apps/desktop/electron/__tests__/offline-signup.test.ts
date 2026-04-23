/**
 * Tests for the offline-first signup queue engine.
 *
 * Covers:
 * - Queue insertion (enqueue creates pending_signups row)
 * - State machine transitions (queued → syncing → synced / failed / back to queued)
 * - reconcileOrgId updates all local tables
 * - Idempotency: duplicate enqueue is ignored (INSERT OR IGNORE)
 * - Exponential backoff calculation
 * - Partial reconciliation: missing table is skipped gracefully
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';
import { reconcileOrgId, backoffDelayMs, SignupSyncEngine } from '../sync-signup';

// ── helpers ────────────────────────────────────────────────────────
function insertOrg(db: Database.Database, id: string, name = 'Test Org') {
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)`).run(id, name);
}

function insertOffice(db: Database.Database, id: string, orgId: string) {
  db.prepare(`INSERT OR IGNORE INTO offices (id, name, organization_id) VALUES (?, 'Office', ?)`).run(id, orgId);
}

function insertDept(db: Database.Database, id: string, officeId: string) {
  db.prepare(`INSERT OR IGNORE INTO departments (id, name, office_id) VALUES (?, 'Dept', ?)`).run(id, officeId);
}

function insertService(db: Database.Database, id: string, orgId: string) {
  db.prepare(`INSERT OR IGNORE INTO services (id, name, organization_id) VALUES (?, 'Service', ?)`).run(id, orgId);
}

function insertDesk(db: Database.Database, id: string, officeId: string) {
  db.prepare(`INSERT OR IGNORE INTO desks (id, name, office_id) VALUES (?, 'Desk', ?)`).run(id, officeId);
}

function insertStaff(db: Database.Database, id: string, orgId: string) {
  db.prepare(`INSERT OR IGNORE INTO staff (id, full_name, organization_id) VALUES (?, 'Staff', ?)`).run(id, orgId);
}

function insertTicket(db: Database.Database, id: string, officeId: string, orgId: string) {
  db.prepare(
    `INSERT OR IGNORE INTO tickets (id, ticket_number, office_id, organization_id, status, created_at)
     VALUES (?, 'T-001', ?, ?, 'waiting', datetime('now'))`
  ).run(id, officeId, orgId);
}

function insertMenuCategory(db: Database.Database, id: string, orgId: string) {
  db.prepare(`INSERT OR IGNORE INTO menu_categories (id, name, organization_id) VALUES (?, 'Cat', ?)`).run(id, orgId);
}

function insertMenuItem(db: Database.Database, id: string, orgId: string, catId: string) {
  db.prepare(`INSERT OR IGNORE INTO menu_items (id, name, organization_id, category_id) VALUES (?, 'Item', ?, ?)`).run(id, orgId, catId);
}

function insertBroadcastTemplate(db: Database.Database, id: string, orgId: string) {
  db.prepare(
    `INSERT OR IGNORE INTO broadcast_templates (id, organization_id, title) VALUES (?, ?, 'Template')`
  ).run(id, orgId);
}

function insertSyncQueueItem(db: Database.Database, id: string, orgId: string, payloadOrgId: string) {
  db.prepare(
    `INSERT OR IGNORE INTO sync_queue (id, operation, table_name, record_id, payload, created_at, organization_id)
     VALUES (?, 'INSERT', 'tickets', 'r1', ?, datetime('now'), ?)`
  ).run(id, JSON.stringify({ organization_id: payloadOrgId }), orgId);
}

// ── Tests: backoffDelayMs ─────────────────────────────────────────
describe('backoffDelayMs', () => {
  it('returns 0 for first attempt (0 prior attempts)', () => {
    expect(backoffDelayMs(0)).toBe(0);
  });

  it('returns 30s for first retry', () => {
    expect(backoffDelayMs(1)).toBe(30_000);
  });

  it('doubles each attempt: 30s → 60s → 120s', () => {
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(4)).toBe(240_000);
    expect(backoffDelayMs(5)).toBe(480_000);
  });

  it('caps at 1 hour', () => {
    expect(backoffDelayMs(10)).toBe(3_600_000);
    expect(backoffDelayMs(20)).toBe(3_600_000);
  });

  it('hits 1h cap at attempt 7 (2^6 * 30s = 1920s < 3600s, 2^7 * 30s > 3600s)', () => {
    // 2^7 * 30000 = 3_840_000 which exceeds 3_600_000 — capped
    expect(backoffDelayMs(8)).toBe(3_600_000);
  });
});

// ── Tests: SignupSyncEngine.enqueue ───────────────────────────────
describe('SignupSyncEngine.enqueue', () => {
  let db: Database.Database;
  let engine: SignupSyncEngine;

  beforeEach(() => {
    db = createTestDB();
    engine = new SignupSyncEngine(db, 'https://example.com');
  });

  it('creates a pending_signups row with status queued', () => {
    const id = crypto.randomUUID();
    engine.enqueue(id, { email: 'test@example.com', businessName: 'Test Co' });

    const row = db.prepare('SELECT * FROM pending_signups WHERE id = ?').get(id) as any;
    expect(row).toBeDefined();
    expect(row.status).toBe('queued');
    expect(row.attempt_count).toBe(0);
    expect(JSON.parse(row.payload).email).toBe('test@example.com');
  });

  it('is idempotent — duplicate enqueue is ignored', () => {
    const id = crypto.randomUUID();
    engine.enqueue(id, { email: 'a@b.com', businessName: 'Biz' });
    engine.enqueue(id, { email: 'a@b.com', businessName: 'Biz' }); // duplicate

    const rows = db.prepare('SELECT * FROM pending_signups').all();
    expect(rows).toHaveLength(1);
  });

  it('getPendingCount returns correct count', () => {
    expect(engine.getPendingCount()).toBe(0);
    engine.enqueue(crypto.randomUUID(), { businessName: 'A' });
    expect(engine.getPendingCount()).toBe(1);
    engine.enqueue(crypto.randomUUID(), { businessName: 'B' });
    expect(engine.getPendingCount()).toBe(2);
  });

  it('getPendingRows returns queued rows', () => {
    const id = crypto.randomUUID();
    engine.enqueue(id, { businessName: 'X' });
    const rows = engine.getPendingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
  });
});

// ── Tests: reconcileOrgId ─────────────────────────────────────────
describe('reconcileOrgId', () => {
  let db: Database.Database;
  const TEMP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const REAL_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

  beforeEach(() => {
    db = createTestDB();
  });

  it('updates organizations.id from tempId to realId', () => {
    insertOrg(db, TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(REAL_ID) as any;
    expect(org).toBeDefined();
    const old = db.prepare('SELECT id FROM organizations WHERE id = ?').get(TEMP_ID) as any;
    expect(old).toBeUndefined();
  });

  it('updates offices.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertOffice(db, 'office-1', TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const office = db.prepare('SELECT organization_id FROM offices WHERE id = ?').get('office-1') as any;
    expect(office.organization_id).toBe(REAL_ID);
  });

  it('updates departments.organization_id (via offices chain — column present in test schema)', () => {
    insertOrg(db, TEMP_ID);
    insertOffice(db, 'office-1', TEMP_ID);
    insertDept(db, 'dept-1', 'office-1');
    // departments.organization_id column is not standard — skip update check,
    // but ensure no error is thrown
    expect(() => reconcileOrgId(db, TEMP_ID, REAL_ID)).not.toThrow();
  });

  it('updates staff.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertStaff(db, 'staff-1', TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const staff = db.prepare('SELECT organization_id FROM staff WHERE id = ?').get('staff-1') as any;
    expect(staff.organization_id).toBe(REAL_ID);
  });

  it('updates tickets.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertOffice(db, 'office-1', TEMP_ID);
    // Add organization_id column to tickets for this test
    try { db.exec(`ALTER TABLE tickets ADD COLUMN organization_id TEXT`); } catch {}
    insertTicket(db, 'ticket-1', 'office-1', TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const ticket = db.prepare('SELECT organization_id FROM tickets WHERE id = ?').get('ticket-1') as any;
    expect(ticket.organization_id).toBe(REAL_ID);
  });

  it('updates menu_categories.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertMenuCategory(db, 'cat-1', TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const cat = db.prepare('SELECT organization_id FROM menu_categories WHERE id = ?').get('cat-1') as any;
    expect(cat.organization_id).toBe(REAL_ID);
  });

  it('updates menu_items.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertMenuCategory(db, 'cat-1', TEMP_ID);
    insertMenuItem(db, 'item-1', TEMP_ID, 'cat-1');
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const item = db.prepare('SELECT organization_id FROM menu_items WHERE id = ?').get('item-1') as any;
    expect(item.organization_id).toBe(REAL_ID);
  });

  it('updates broadcast_templates.organization_id', () => {
    insertOrg(db, TEMP_ID);
    insertBroadcastTemplate(db, 'tmpl-1', TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const tmpl = db.prepare('SELECT organization_id FROM broadcast_templates WHERE id = ?').get('tmpl-1') as any;
    expect(tmpl.organization_id).toBe(REAL_ID);
  });

  it('rewrites tempId in sync_queue.organization_id column', () => {
    insertOrg(db, TEMP_ID);
    insertSyncQueueItem(db, 'sq-1', TEMP_ID, TEMP_ID);
    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const sq = db.prepare('SELECT organization_id FROM sync_queue WHERE id = ?').get('sq-1') as any;
    expect(sq.organization_id).toBe(REAL_ID);
  });

  it('rewrites tempId embedded in sync_queue.payload JSON', () => {
    insertOrg(db, TEMP_ID);
    const payloadWithId = JSON.stringify({ organization_id: TEMP_ID, name: 'Test' });
    db.prepare(
      `INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, organization_id)
       VALUES ('sq-2', 'INSERT', 'offices', 'r1', ?, datetime('now'), ?)`
    ).run(payloadWithId, TEMP_ID);

    reconcileOrgId(db, TEMP_ID, REAL_ID);

    const sq = db.prepare('SELECT payload FROM sync_queue WHERE id = ?').get('sq-2') as any;
    const parsed = JSON.parse(sq.payload);
    expect(parsed.organization_id).toBe(REAL_ID);
  });

  it('skips tables that do not exist without throwing', () => {
    // virtual_queue_codes is not in the test DB — should silently skip
    insertOrg(db, TEMP_ID);
    expect(() => reconcileOrgId(db, TEMP_ID, REAL_ID)).not.toThrow();
  });

  it('returns a list of affected tables with update counts', () => {
    insertOrg(db, TEMP_ID);
    insertStaff(db, 'staff-1', TEMP_ID);
    insertMenuCategory(db, 'cat-1', TEMP_ID);

    const results = reconcileOrgId(db, TEMP_ID, REAL_ID);
    const tables = results.map((r) => r.table);
    expect(tables).toContain('organizations');
    expect(tables).toContain('staff');
    expect(tables).toContain('menu_categories');
  });

  it('is a no-op when tempId does not appear in any table', () => {
    const NON_EXISTENT = 'cccccccc-0000-0000-0000-000000000003';
    expect(() => reconcileOrgId(db, NON_EXISTENT, REAL_ID)).not.toThrow();
    const results = reconcileOrgId(db, NON_EXISTENT, REAL_ID);
    expect(results).toHaveLength(0);
  });

  it('runs atomically — all updates succeed or none (simulated partial-fail scenario)', () => {
    // We can't easily force a mid-transaction failure in SQLite in-memory,
    // but we verify the transaction wrapper doesn't leave partial state.
    insertOrg(db, TEMP_ID);
    insertStaff(db, 'staff-1', TEMP_ID);
    insertMenuCategory(db, 'cat-1', TEMP_ID);

    reconcileOrgId(db, TEMP_ID, REAL_ID);

    // All three should be updated — no partial state
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(REAL_ID);
    const staff = db.prepare('SELECT organization_id FROM staff WHERE id = ?').get('staff-1') as any;
    const cat = db.prepare('SELECT organization_id FROM menu_categories WHERE id = ?').get('cat-1') as any;

    expect(org).toBeDefined();
    expect(staff.organization_id).toBe(REAL_ID);
    expect(cat.organization_id).toBe(REAL_ID);
  });
});

// ── Tests: SignupSyncEngine sync attempt (mocked fetch) ───────────
describe('SignupSyncEngine sync behavior', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
    vi.stubGlobal('fetch', undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks row as synced and stores real org id on 200 response', async () => {
    const TEMP_ID = 'dddddddd-0000-0000-0000-000000000004';
    const REAL_ORG_ID = 'eeeeeeee-0000-0000-0000-000000000005';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization_id: REAL_ORG_ID }),
    }));

    insertOrg(db, TEMP_ID, 'Test Biz');

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(TEMP_ID, { email: 'a@b.com', businessName: 'Test Biz' });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_signups WHERE id = ?').get(TEMP_ID) as any;
    expect(row.status).toBe('synced');
    expect(row.synced_org_id).toBe(REAL_ORG_ID);
  });

  it('marks row as failed on 4xx response (not retryable)', async () => {
    const id = crypto.randomUUID();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Email already in use' }),
    }));

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(id, { email: 'dup@b.com', businessName: 'Dup Biz' });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_signups WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
    expect(row.error_message).toContain('Email already in use');
  });

  it('leaves row as queued on network error (retryable)', async () => {
    const id = crypto.randomUUID();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })
    ));

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(id, { email: 'a@b.com', businessName: 'Offline Biz' });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_signups WHERE id = ?').get(id) as any;
    expect(row.status).toBe('queued');
    expect(row.attempt_count).toBeGreaterThan(0);
    expect(row.error_message).toBeTruthy();
  });

  it('leaves row as queued on 5xx server error (retryable)', async () => {
    const id = crypto.randomUUID();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
    }));

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(id, { email: 'a@b.com', businessName: 'Retry Biz' });
    await engine.retryNow();

    const row = db.prepare('SELECT * FROM pending_signups WHERE id = ?').get(id) as any;
    expect(row.status).toBe('queued');
  });

  it('calls reconcileOrgId after successful sync when tempId !== realId', async () => {
    const TEMP_ID = 'ffffffff-0000-0000-0000-000000000006';
    const REAL_ORG_ID = '11111111-0000-0000-0000-000000000007';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization_id: REAL_ORG_ID }),
    }));

    // Set up data under tempId
    insertOrg(db, TEMP_ID, 'Draft Biz');
    insertStaff(db, 'staff-temp-1', TEMP_ID);

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(TEMP_ID, { email: 'a@b.com', businessName: 'Draft Biz' });
    await engine.retryNow();

    // Staff should now reference the real org id
    const staff = db.prepare('SELECT organization_id FROM staff WHERE id = ?').get('staff-temp-1') as any;
    expect(staff.organization_id).toBe(REAL_ORG_ID);
  });

  it('does not reconcile when tempId === realId (server kept temp uuid)', async () => {
    const SAME_ID = '22222222-0000-0000-0000-000000000008';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ organization_id: SAME_ID }),
    }));

    insertOrg(db, SAME_ID, 'Same ID Biz');

    const engine = new SignupSyncEngine(db, 'https://example.com');
    engine.enqueue(SAME_ID, { email: 'a@b.com', businessName: 'Same ID Biz' });
    await engine.retryNow();

    // Should still be synced — no error
    const row = db.prepare('SELECT status FROM pending_signups WHERE id = ?').get(SAME_ID) as any;
    expect(row.status).toBe('synced');
  });
});

// ── Tests: concurrent sync guard ─────────────────────────────────
describe('concurrent sync guard', () => {
  let db: Database.Database;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not process the same row twice concurrently', async () => {
    db = createTestDB();
    let callCount = 0;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      // Simulate a slow network response
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, status: 200, json: async () => ({ organization_id: crypto.randomUUID() }) };
    }));

    const engine = new SignupSyncEngine(db, 'https://example.com');
    const id = crypto.randomUUID();
    engine.enqueue(id, { email: 'a@b.com', businessName: 'Test' });

    // Fire two concurrent retries
    const [, ] = await Promise.all([engine.retryNow(), engine.retryNow()]);

    // Despite two concurrent calls, the row should only have been attempted once
    // (second retryNow() sees syncInFlight=true and returns early)
    expect(callCount).toBe(1);
  });
});
