import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

/** Helper: get all table names in the database */
function getTableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[])
    .map(r => r.name);
}

/** Helper: get column names for a given table */
function getColumnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as any[]).map(c => c.name);
}

/** Helper: get index names for a given table */
function getIndexNames(db: Database.Database, table: string): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? ORDER BY name").all(table) as any[])
    .map(r => r.name);
}

describe('Database schema — fresh install', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
  });

  it('creates all expected tables', () => {
    const tables = getTableNames(db);
    const expected = ['tickets', 'offices', 'departments', 'services', 'desks', 'sync_queue', 'session', 'ticket_counter', 'ticket_counter_mono'];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  // ── tickets table ──

  describe('tickets table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'tickets');
      const expected = [
        'id', 'ticket_number', 'office_id', 'department_id', 'service_id',
        'desk_id', 'status', 'priority', 'customer_data', 'created_at',
        'called_at', 'called_by_staff_id', 'serving_started_at', 'completed_at',
        'cancelled_at', 'parked_at', 'recall_count', 'notes', 'is_remote',
        'is_offline', 'appointment_id', 'synced_at',
      ];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });

    it('id is the primary key', () => {
      const info = db.pragma('table_info(tickets)') as any[];
      const idCol = info.find(c => c.name === 'id');
      expect(idCol.pk).toBe(1);
    });

    it('status defaults to waiting', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT status FROM tickets WHERE id = 't1'").get() as any;
      expect(row.status).toBe('waiting');
    });

    it('priority defaults to 0', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT priority FROM tickets WHERE id = 't1'").get() as any;
      expect(row.priority).toBe(0);
    });

    it('recall_count defaults to 0', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT recall_count FROM tickets WHERE id = 't1'").get() as any;
      expect(row.recall_count).toBe(0);
    });

    it('is_remote defaults to 0', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT is_remote FROM tickets WHERE id = 't1'").get() as any;
      expect(row.is_remote).toBe(0);
    });

    it('is_offline defaults to 0', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT is_offline FROM tickets WHERE id = 't1'").get() as any;
      expect(row.is_offline).toBe(0);
    });

    it('customer_data defaults to empty JSON object', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT customer_data FROM tickets WHERE id = 't1'").get() as any;
      expect(row.customer_data).toBe('{}');
    });

    it('nullable columns accept NULL', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      const row = db.prepare("SELECT desk_id, department_id, service_id, called_at, appointment_id FROM tickets WHERE id = 't1'").get() as any;
      expect(row.desk_id).toBeNull();
      expect(row.department_id).toBeNull();
      expect(row.service_id).toBeNull();
      expect(row.called_at).toBeNull();
      expect(row.appointment_id).toBeNull();
    });

    it('rejects duplicate primary keys', () => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, created_at)
        VALUES ('t1', 'G-001', 'o1', datetime('now'))
      `).run();
      expect(() => {
        db.prepare(`
          INSERT INTO tickets (id, ticket_number, office_id, created_at)
          VALUES ('t1', 'G-002', 'o1', datetime('now'))
        `).run();
      }).toThrow();
    });
  });

  // ── desks table ──

  describe('desks table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'desks');
      const expected = ['id', 'name', 'department_id', 'office_id', 'is_active', 'current_staff_id'];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });

    it('is_active defaults to 1', () => {
      db.prepare("INSERT INTO desks (id, name) VALUES ('d1', 'Desk 1')").run();
      const row = db.prepare("SELECT is_active FROM desks WHERE id = 'd1'").get() as any;
      expect(row.is_active).toBe(1);
    });
  });

  // ── offices table ──

  describe('offices table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'offices');
      const expected = ['id', 'name', 'address', 'organization_id', 'settings', 'updated_at'];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });

    it('settings defaults to empty JSON object', () => {
      db.prepare("INSERT INTO offices (id, name) VALUES ('o1', 'Office 1')").run();
      const row = db.prepare("SELECT settings FROM offices WHERE id = 'o1'").get() as any;
      expect(row.settings).toBe('{}');
    });
  });

  // ── departments table ──

  describe('departments table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'departments');
      const expected = ['id', 'name', 'code', 'office_id', 'updated_at'];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });
  });

  // ── services table ──

  describe('services table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'services');
      const expected = ['id', 'name', 'department_id', 'estimated_service_time', 'updated_at'];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });

    it('estimated_service_time defaults to 10', () => {
      db.prepare("INSERT INTO services (id, name) VALUES ('s1', 'Service 1')").run();
      const row = db.prepare("SELECT estimated_service_time FROM services WHERE id = 's1'").get() as any;
      expect(row.estimated_service_time).toBe(10);
    });
  });

  // ── sync_queue table ──

  describe('sync_queue table', () => {
    it('has all expected columns', () => {
      const cols = getColumnNames(db, 'sync_queue');
      const expected = ['id', 'operation', 'table_name', 'record_id', 'payload', 'created_at', 'attempts', 'last_error', 'synced_at'];
      for (const col of expected) {
        expect(cols).toContain(col);
      }
    });

    it('attempts defaults to 0', () => {
      db.prepare(`
        INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
        VALUES ('sq1', 'INSERT', 'tickets', 'r1', '{}', datetime('now'))
      `).run();
      const row = db.prepare("SELECT attempts FROM sync_queue WHERE id = 'sq1'").get() as any;
      expect(row.attempts).toBe(0);
    });
  });

  // ── session table ──

  describe('session table', () => {
    it('has key and value columns', () => {
      const cols = getColumnNames(db, 'session');
      expect(cols).toContain('key');
      expect(cols).toContain('value');
    });

    it('key is primary key (upsert works)', () => {
      db.prepare("INSERT INTO session (key, value) VALUES ('token', 'abc')").run();
      db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('token', 'xyz')").run();
      const row = db.prepare("SELECT value FROM session WHERE key = 'token'").get() as any;
      expect(row.value).toBe('xyz');
    });
  });

  // ── ticket_counter table ──

  describe('ticket_counter table', () => {
    it('has composite primary key (office_id, dept_code, date)', () => {
      db.prepare("INSERT INTO ticket_counter (office_id, dept_code, counter, date) VALUES ('o1', 'G', 1, '2026-04-10')").run();
      // Same key should conflict
      expect(() => {
        db.prepare("INSERT INTO ticket_counter (office_id, dept_code, counter, date) VALUES ('o1', 'G', 2, '2026-04-10')").run();
      }).toThrow();
      // Different date is OK
      db.prepare("INSERT INTO ticket_counter (office_id, dept_code, counter, date) VALUES ('o1', 'G', 1, '2026-04-11')").run();
    });
  });

  // ── ticket_counter_mono table ──

  describe('ticket_counter_mono table', () => {
    it('has composite primary key (office_id, dept_code)', () => {
      db.prepare("INSERT INTO ticket_counter_mono (office_id, dept_code, counter) VALUES ('o1', 'G', 1)").run();
      expect(() => {
        db.prepare("INSERT INTO ticket_counter_mono (office_id, dept_code, counter) VALUES ('o1', 'G', 2)").run();
      }).toThrow();
    });

    it('supports UPSERT for atomic increment', () => {
      const row1 = db.prepare(`
        INSERT INTO ticket_counter_mono (office_id, dept_code, counter, updated_at)
        VALUES ('o1', 'G', 1, datetime('now'))
        ON CONFLICT (office_id, dept_code)
        DO UPDATE SET counter = counter + 1, updated_at = datetime('now')
        RETURNING counter
      `).get() as any;
      expect(row1.counter).toBe(1);

      const row2 = db.prepare(`
        INSERT INTO ticket_counter_mono (office_id, dept_code, counter, updated_at)
        VALUES ('o1', 'G', 1, datetime('now'))
        ON CONFLICT (office_id, dept_code)
        DO UPDATE SET counter = counter + 1, updated_at = datetime('now')
        RETURNING counter
      `).get() as any;
      expect(row2.counter).toBe(2);
    });
  });

  // ── Indexes ──

  describe('indexes', () => {
    it('has index on tickets(office_id, status)', () => {
      const indexes = getIndexNames(db, 'tickets');
      expect(indexes).toContain('idx_tickets_office_status');
    });

    it('has index on tickets(created_at)', () => {
      const indexes = getIndexNames(db, 'tickets');
      expect(indexes).toContain('idx_tickets_created');
    });

    it('has index on sync_queue for pending items', () => {
      const indexes = getIndexNames(db, 'sync_queue');
      expect(indexes).toContain('idx_sync_queue_pending');
    });
  });

  // ── Data integrity ──

  describe('data integrity', () => {
    it('foreign_keys pragma is ON', () => {
      const fk = db.pragma('foreign_keys') as any[];
      expect(fk[0].foreign_keys).toBe(1);
    });

    it('journal_mode is set (WAL on disk, memory for in-memory)', () => {
      const jm = db.pragma('journal_mode') as any[];
      // In-memory databases report 'memory' instead of 'wal'
      expect(['wal', 'memory']).toContain(jm[0].journal_mode);
    });

    it('database passes integrity check', () => {
      const result = db.pragma('integrity_check') as any[];
      expect(result[0].integrity_check).toBe('ok');
    });
  });

  // ── Empty database behavior ──

  describe('empty database behavior', () => {
    it('all tables start empty', () => {
      const tables = ['tickets', 'offices', 'departments', 'services', 'desks', 'sync_queue', 'session', 'ticket_counter', 'ticket_counter_mono'];
      for (const table of tables) {
        const count = (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c;
        expect(count).toBe(0);
      }
    });

    it('can insert and retrieve data in all core tables', () => {
      db.prepare("INSERT INTO offices (id, name) VALUES ('o1', 'Office')").run();
      db.prepare("INSERT INTO departments (id, name, office_id) VALUES ('d1', 'Dept', 'o1')").run();
      db.prepare("INSERT INTO services (id, name, department_id) VALUES ('s1', 'Svc', 'd1')").run();
      db.prepare("INSERT INTO desks (id, name, office_id) VALUES ('dk1', 'Desk', 'o1')").run();
      db.prepare("INSERT INTO tickets (id, ticket_number, office_id, department_id, created_at) VALUES ('t1', 'G-001', 'o1', 'd1', datetime('now'))").run();
      db.prepare("INSERT INTO session (key, value) VALUES ('test', 'val')").run();

      expect((db.prepare("SELECT COUNT(*) as c FROM offices").get() as any).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM departments").get() as any).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM services").get() as any).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM desks").get() as any).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM tickets").get() as any).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM session").get() as any).c).toBe(1);
    });
  });
});
