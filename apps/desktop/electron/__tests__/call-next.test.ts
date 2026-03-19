import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB, CALL_NEXT_SQL } from './helpers';

describe('Atomic call-next', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
    // Seed 3 waiting tickets in order
    db.prepare(`INSERT INTO tickets (id, ticket_number, office_id, status, priority, created_at)
      VALUES ('t1', 'R-001', 'office1', 'waiting', 0, '2026-03-18T08:00:00Z')`).run();
    db.prepare(`INSERT INTO tickets (id, ticket_number, office_id, status, priority, created_at)
      VALUES ('t2', 'R-002', 'office1', 'waiting', 0, '2026-03-18T08:01:00Z')`).run();
    db.prepare(`INSERT INTO tickets (id, ticket_number, office_id, status, priority, created_at)
      VALUES ('t3', 'R-003', 'office1', 'waiting', 0, '2026-03-18T08:02:00Z')`).run();
  });

  it('two sequential calls get different tickets', () => {
    const callNext = db.prepare(CALL_NEXT_SQL);
    const now = new Date().toISOString();

    const result1 = callNext.get('desk-a', 'staff-1', now, 'office1') as any;
    const result2 = callNext.get('desk-b', 'staff-2', now, 'office1') as any;

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    expect(result1.id).toBe('t1'); // first in queue
    expect(result2.id).toBe('t2'); // second in queue
    expect(result1.id).not.toBe(result2.id);
    expect(result1.status).toBe('called');
    expect(result1.desk_id).toBe('desk-a');
  });

  it('returns undefined when no waiting tickets', () => {
    db.prepare("UPDATE tickets SET status = 'served'").run();
    const callNext = db.prepare(CALL_NEXT_SQL);
    const result = callNext.get('desk-a', 'staff-1', new Date().toISOString(), 'office1');
    expect(result).toBeUndefined();
  });

  it('respects priority ordering (higher priority first)', () => {
    // Give t3 highest priority
    db.prepare("UPDATE tickets SET priority = 10 WHERE id = 't3'").run();

    const callNext = db.prepare(CALL_NEXT_SQL);
    const result = callNext.get('desk-a', 'staff-1', new Date().toISOString(), 'office1') as any;

    expect(result.id).toBe('t3');
    expect(result.ticket_number).toBe('R-003');
  });

  it('skips parked tickets', () => {
    db.prepare("UPDATE tickets SET parked_at = '2026-03-18T09:00:00Z' WHERE id = 't1'").run();

    const callNext = db.prepare(CALL_NEXT_SQL);
    const result = callNext.get('desk-a', 'staff-1', new Date().toISOString(), 'office1') as any;

    expect(result.id).toBe('t2'); // t1 is parked, so t2 is next
  });

  it('only picks tickets from the specified office', () => {
    const callNext = db.prepare(CALL_NEXT_SQL);
    const result = callNext.get('desk-a', 'staff-1', new Date().toISOString(), 'other-office');
    expect(result).toBeUndefined();
  });

  it('three desks calling simultaneously all get different tickets', () => {
    const callNext = db.prepare(CALL_NEXT_SQL);
    const now = new Date().toISOString();

    const r1 = callNext.get('desk-a', 'staff-1', now, 'office1') as any;
    const r2 = callNext.get('desk-b', 'staff-2', now, 'office1') as any;
    const r3 = callNext.get('desk-c', 'staff-3', now, 'office1') as any;

    expect(r1.id).toBe('t1');
    expect(r2.id).toBe('t2');
    expect(r3.id).toBe('t3');

    // Queue should now be empty
    const r4 = callNext.get('desk-d', 'staff-4', now, 'office1');
    expect(r4).toBeUndefined();
  });
});
