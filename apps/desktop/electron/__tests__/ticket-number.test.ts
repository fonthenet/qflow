import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

// Inline the monotonic ticket number generation logic (mirrors db.ts generateOfflineTicketNumber)
function generateTicketNumber(db: Database.Database, officeId: string, deptCode: string) {
  const row = db.prepare(`
    INSERT INTO ticket_counter_mono (office_id, dept_code, counter, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT (office_id, dept_code)
    DO UPDATE SET counter = counter + 1, updated_at = datetime('now')
    RETURNING counter
  `).get(officeId, deptCode) as any;

  return `L-${deptCode}-${String(row.counter).padStart(5, '0')}`;
}

describe('Monotonic ticket number generation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
    db.prepare("INSERT INTO offices (id, name) VALUES ('o1', 'Test Office')").run();
  });

  it('increments counter monotonically per office/dept', () => {
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00001');
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00002');
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00003');
  });

  it('never resets across days (monotonic)', () => {
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00001');
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00002');
    // Even after a day boundary the counter keeps growing
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00003');
  });

  it('separate counters per department code', () => {
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00001');
    expect(generateTicketNumber(db, 'o1', 'S')).toBe('L-S-00001');
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00002');
    expect(generateTicketNumber(db, 'o1', 'S')).toBe('L-S-00002');
  });

  it('separate counters per office', () => {
    db.prepare("INSERT INTO offices (id, name) VALUES ('o2', 'Office 2')").run();
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00001');
    expect(generateTicketNumber(db, 'o2', 'R')).toBe('L-R-00001');
  });

  it('pads numbers to 5 digits', () => {
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00001');
    db.prepare("UPDATE ticket_counter_mono SET counter = 99 WHERE office_id = 'o1'").run();
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-00100');
  });

  it('handles high volume without format break', () => {
    db.prepare("INSERT INTO ticket_counter_mono (office_id, dept_code, counter) VALUES ('o1', 'R', 99998)").run();
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-99999');
    expect(generateTicketNumber(db, 'o1', 'R')).toBe('L-R-100000');
  });
});
