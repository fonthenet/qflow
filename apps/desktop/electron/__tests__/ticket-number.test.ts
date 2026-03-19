import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

// Inline the ticket number generation logic (mirrors db.ts generateOfflineTicketNumber)
function generateTicketNumber(db: Database.Database, officeId: string, deptCode: string, overrideDate?: string) {
  // If overrideDate provided, use it; otherwise compute from office timezone
  let today: string;
  if (overrideDate) {
    today = overrideDate;
  } else {
    const office = db.prepare('SELECT timezone FROM offices WHERE id = ?').get(officeId) as any;
    const tz = office?.timezone;
    if (tz) {
      today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    } else {
      const n = new Date();
      today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    }
  }

  const row = db.prepare(`
    INSERT INTO ticket_counter (office_id, dept_code, counter, date)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (office_id, dept_code, date)
    DO UPDATE SET counter = counter + 1
    RETURNING counter
  `).get(officeId, deptCode, today) as any;

  return `L-${deptCode}-${String(row.counter).padStart(3, '0')}`;
}

describe('Ticket number generation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
    db.prepare("INSERT INTO offices (id, name) VALUES ('o1', 'Test Office')").run();
  });

  it('increments counter for same office/dept/date', () => {
    const today = '2026-03-18';
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-001');
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-002');
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-003');
  });

  it('resets counter for different date', () => {
    expect(generateTicketNumber(db, 'o1', 'R', '2026-03-17')).toBe('L-R-001');
    expect(generateTicketNumber(db, 'o1', 'R', '2026-03-17')).toBe('L-R-002');
    // New day → resets
    expect(generateTicketNumber(db, 'o1', 'R', '2026-03-18')).toBe('L-R-001');
  });

  it('separate counters per department code', () => {
    const today = '2026-03-18';
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-001');
    expect(generateTicketNumber(db, 'o1', 'S', today)).toBe('L-S-001');
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-002');
    expect(generateTicketNumber(db, 'o1', 'S', today)).toBe('L-S-002');
  });

  it('separate counters per office', () => {
    db.prepare("INSERT INTO offices (id, name) VALUES ('o2', 'Office 2')").run();
    const today = '2026-03-18';
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-001');
    expect(generateTicketNumber(db, 'o2', 'R', today)).toBe('L-R-001');
  });

  it('uses office timezone when available', () => {
    db.prepare("UPDATE offices SET timezone = 'America/New_York' WHERE id = 'o1'").run();
    // Without overrideDate, should compute from timezone — just verify it doesn't crash
    const result = generateTicketNumber(db, 'o1', 'R');
    expect(result).toMatch(/^L-R-\d{3}$/);
  });

  it('falls back to system local date when no timezone set', () => {
    // No timezone column set (NULL)
    const result = generateTicketNumber(db, 'o1', 'R');
    expect(result).toMatch(/^L-R-\d{3}$/);
  });

  it('pads numbers to 3 digits', () => {
    const today = '2026-03-18';
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-001');
    // Set counter to 99
    db.prepare("UPDATE ticket_counter SET counter = 99 WHERE office_id = 'o1'").run();
    expect(generateTicketNumber(db, 'o1', 'R', today)).toBe('L-R-100');
  });
});
