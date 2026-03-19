import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

describe('Sync queue auto-discard rules', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it('discards UPDATE items after 5 failed attempts', () => {
    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('sq1', 'UPDATE', 'tickets', 'r1', '{}', '2026-01-01', 5);

    db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();

    const remaining = db.prepare("SELECT * FROM sync_queue").all();
    expect(remaining).toHaveLength(0);
  });

  it('discards CALL items after 5 failed attempts', () => {
    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('sq1', 'CALL', 'tickets', 'r1', '{}', '2026-01-01', 5);

    db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();

    const remaining = db.prepare("SELECT * FROM sync_queue").all();
    expect(remaining).toHaveLength(0);
  });

  it('NEVER discards INSERT items even after many failed attempts', () => {
    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('sq1', 'INSERT', 'tickets', 'r1', '{}', '2026-01-01', 10);

    db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();

    const remaining = db.prepare("SELECT * FROM sync_queue").all();
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as any).operation).toBe('INSERT');
  });

  it('mixed operations: only INSERT survives', () => {
    const stmt = db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    stmt.run('sq1', 'INSERT', 'tickets', 'r1', '{}', '2026-01-01', 7);
    stmt.run('sq2', 'UPDATE', 'tickets', 'r2', '{}', '2026-01-01', 6);
    stmt.run('sq3', 'CALL', 'tickets', 'r3', '{}', '2026-01-01', 5);
    stmt.run('sq4', 'INSERT', 'tickets', 'r4', '{}', '2026-01-01', 15);

    db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();

    const remaining = db.prepare("SELECT * FROM sync_queue ORDER BY id").all() as any[];
    expect(remaining).toHaveLength(2);
    expect(remaining[0].id).toBe('sq1');
    expect(remaining[1].id).toBe('sq4');
  });

  it('does not discard items below 5 attempts', () => {
    const stmt = db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    stmt.run('sq1', 'UPDATE', 'tickets', 'r1', '{}', '2026-01-01', 4);
    stmt.run('sq2', 'CALL', 'tickets', 'r2', '{}', '2026-01-01', 3);

    db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5 AND operation != 'INSERT'"
    ).run();

    const remaining = db.prepare("SELECT * FROM sync_queue").all();
    expect(remaining).toHaveLength(2);
  });
});

describe('Exponential backoff', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it('next_retry_at is respected in pending query', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60000).toISOString(); // 1 min from now
    const past = new Date(now.getTime() - 60000).toISOString();   // 1 min ago

    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('sq1', 'UPDATE', 'tickets', 'r1', '{}', '2026-01-01', 2, future); // not yet

    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run('sq2', 'UPDATE', 'tickets', 'r2', '{}', '2026-01-01', 1, past); // ready

    db.prepare(
      "INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('sq3', 'INSERT', 'tickets', 'r3', '{}', '2026-01-01', 0); // no next_retry_at = ready

    const pending = db.prepare(
      "SELECT * FROM sync_queue WHERE synced_at IS NULL AND attempts < 10 AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC"
    ).all(now.toISOString()) as any[];

    expect(pending).toHaveLength(2);
    expect(pending.map((p: any) => p.id).sort()).toEqual(['sq2', 'sq3']);
  });

  it('backoff delay doubles each attempt', () => {
    // Simulate the delay calculation
    function getDelay(attempts: number): number {
      return Math.min(15000 * Math.pow(2, attempts - 1), 300000);
    }

    expect(getDelay(1)).toBe(15000);   // 15s
    expect(getDelay(2)).toBe(30000);   // 30s
    expect(getDelay(3)).toBe(60000);   // 60s
    expect(getDelay(4)).toBe(120000);  // 120s
    expect(getDelay(5)).toBe(240000);  // 240s
    expect(getDelay(6)).toBe(300000);  // 300s (capped at 5min)
    expect(getDelay(7)).toBe(300000);  // still capped
  });
});
