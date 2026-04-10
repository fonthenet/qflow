import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDB } from './helpers';

/**
 * Simulates the appointment check-in transaction logic from kiosk-server.ts.
 *
 * This mirrors the real code path: inside a transaction, check for an existing
 * ticket with the same appointment_id (not cancelled/no_show), and either
 * return the existing ticket (duplicate) or insert a new one.
 */
function checkInAppointment(
  db: Database.Database,
  opts: {
    ticketId: string;
    ticketNumber: string;
    officeId: string;
    departmentId: string;
    serviceId?: string;
    appointmentId: string;
  }
): { ticket: any; duplicate: boolean } {
  const { ticketId, ticketNumber, officeId, departmentId, serviceId, appointmentId } = opts;
  const now = new Date().toISOString();

  let result: { ticket: any; duplicate: boolean } | null = null;

  try {
    db.transaction(() => {
      // Check for duplicate appointment check-in INSIDE the transaction (atomic)
      const existing = db.prepare(
        "SELECT id, ticket_number, status FROM tickets WHERE appointment_id = ? AND status NOT IN ('cancelled', 'no_show') LIMIT 1"
      ).get(appointmentId) as any;

      if (existing) {
        throw { __duplicate: true, id: existing.id, ticket_number: existing.ticket_number, status: existing.status };
      }

      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, appointment_id, customer_data, created_at, is_offline)
        VALUES (?, ?, ?, ?, ?, 'waiting', ?, '{}', ?, 0)
      `).run(ticketId, ticketNumber, officeId, departmentId, serviceId ?? null, appointmentId, now);

      result = {
        ticket: { id: ticketId, ticket_number: ticketNumber, status: 'waiting' },
        duplicate: false,
      };
    })();
  } catch (txErr: any) {
    if (txErr?.__duplicate) {
      result = {
        ticket: { id: txErr.id, ticket_number: txErr.ticket_number, status: txErr.status ?? 'waiting' },
        duplicate: true,
      };
    } else {
      throw txErr;
    }
  }

  return result!;
}

describe('Appointment check-in', () => {
  let db: Database.Database;
  const OFFICE_ID = '11111111-1111-1111-1111-111111111111';
  const DEPT_ID = '22222222-2222-2222-2222-222222222222';
  const APPT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  beforeEach(() => {
    db = createTestDB();
    // Seed office and department
    db.prepare("INSERT INTO offices (id, name) VALUES (?, 'Test Office')").run(OFFICE_ID);
    db.prepare("INSERT INTO departments (id, name, code, office_id) VALUES (?, 'General', 'G', ?)").run(DEPT_ID, OFFICE_ID);

    // Create the unique partial index that the real db.ts creates
    // (helpers.ts createTestDB may not have it)
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_appointment_unique ON tickets (appointment_id) WHERE appointment_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show')`);
    } catch { /* already exists */ }
  });

  it('successful check-in creates a waiting ticket', () => {
    const result = checkInAppointment(db, {
      ticketId: 'tid-1',
      ticketNumber: 'G-001',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });

    expect(result.duplicate).toBe(false);
    expect(result.ticket.id).toBe('tid-1');
    expect(result.ticket.ticket_number).toBe('G-001');
    expect(result.ticket.status).toBe('waiting');

    // Verify ticket actually exists in DB
    const row = db.prepare("SELECT * FROM tickets WHERE id = 'tid-1'").get() as any;
    expect(row).toBeTruthy();
    expect(row.appointment_id).toBe(APPT_ID);
    expect(row.status).toBe('waiting');
  });

  it('duplicate check-in returns existing ticket (not error)', () => {
    // First check-in
    const first = checkInAppointment(db, {
      ticketId: 'tid-1',
      ticketNumber: 'G-001',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });
    expect(first.duplicate).toBe(false);

    // Second check-in for same appointment
    const second = checkInAppointment(db, {
      ticketId: 'tid-2',
      ticketNumber: 'G-002',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });
    expect(second.duplicate).toBe(true);
    expect(second.ticket.id).toBe('tid-1'); // returns original ticket
    expect(second.ticket.ticket_number).toBe('G-001');

    // Only one ticket should exist (the duplicate was not inserted)
    const count = (db.prepare("SELECT COUNT(*) as c FROM tickets WHERE appointment_id = ?").get(APPT_ID) as any).c;
    expect(count).toBe(1);
  });

  it('check-in succeeds if previous ticket for same appointment was cancelled', () => {
    // First check-in
    checkInAppointment(db, {
      ticketId: 'tid-1',
      ticketNumber: 'G-001',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });

    // Cancel the ticket
    db.prepare("UPDATE tickets SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = 'tid-1'").run();

    // Second check-in should succeed (cancelled tickets don't count as duplicates)
    const result = checkInAppointment(db, {
      ticketId: 'tid-2',
      ticketNumber: 'G-002',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });

    expect(result.duplicate).toBe(false);
    expect(result.ticket.id).toBe('tid-2');

    // Two tickets exist but only one is active
    const active = (db.prepare(
      "SELECT COUNT(*) as c FROM tickets WHERE appointment_id = ? AND status NOT IN ('cancelled', 'no_show')"
    ).get(APPT_ID) as any).c;
    expect(active).toBe(1);
  });

  it('check-in succeeds if previous ticket for same appointment was no_show', () => {
    // First check-in
    checkInAppointment(db, {
      ticketId: 'tid-1',
      ticketNumber: 'G-001',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });

    // Mark as no-show
    db.prepare("UPDATE tickets SET status = 'no_show' WHERE id = 'tid-1'").run();

    // New check-in should succeed
    const result = checkInAppointment(db, {
      ticketId: 'tid-2',
      ticketNumber: 'G-002',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: APPT_ID,
    });

    expect(result.duplicate).toBe(false);
    expect(result.ticket.id).toBe('tid-2');
  });

  it('unique index prevents concurrent duplicate inserts', () => {
    // Directly insert a ticket with an appointment_id (bypass the transaction logic)
    db.prepare(`
      INSERT INTO tickets (id, ticket_number, office_id, department_id, status, appointment_id, customer_data, created_at)
      VALUES ('tid-1', 'G-001', ?, ?, 'waiting', ?, '{}', datetime('now'))
    `).run(OFFICE_ID, DEPT_ID, APPT_ID);

    // A raw insert with the same appointment_id should fail due to unique partial index
    expect(() => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, status, appointment_id, customer_data, created_at)
        VALUES ('tid-2', 'G-002', ?, ?, 'waiting', ?, '{}', datetime('now'))
      `).run(OFFICE_ID, DEPT_ID, APPT_ID);
    }).toThrow();
  });

  it('unique index allows same appointment_id when existing is cancelled', () => {
    db.prepare(`
      INSERT INTO tickets (id, ticket_number, office_id, department_id, status, appointment_id, customer_data, created_at)
      VALUES ('tid-1', 'G-001', ?, ?, 'cancelled', ?, '{}', datetime('now'))
    `).run(OFFICE_ID, DEPT_ID, APPT_ID);

    // Should NOT throw — cancelled tickets are excluded from the partial unique index
    expect(() => {
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, status, appointment_id, customer_data, created_at)
        VALUES ('tid-2', 'G-002', ?, ?, 'waiting', ?, '{}', datetime('now'))
      `).run(OFFICE_ID, DEPT_ID, APPT_ID);
    }).not.toThrow();
  });

  it('tickets without appointment_id are not affected by duplicate check', () => {
    // Insert multiple tickets with no appointment_id
    db.prepare(`
      INSERT INTO tickets (id, ticket_number, office_id, department_id, status, customer_data, created_at)
      VALUES ('tid-1', 'G-001', ?, ?, 'waiting', '{}', datetime('now'))
    `).run(OFFICE_ID, DEPT_ID);

    db.prepare(`
      INSERT INTO tickets (id, ticket_number, office_id, department_id, status, customer_data, created_at)
      VALUES ('tid-2', 'G-002', ?, ?, 'waiting', '{}', datetime('now'))
    `).run(OFFICE_ID, DEPT_ID);

    const count = (db.prepare("SELECT COUNT(*) as c FROM tickets WHERE office_id = ?").get(OFFICE_ID) as any).c;
    expect(count).toBe(2);
  });

  it('check-in for non-existent appointment succeeds (creates ticket normally)', () => {
    const fakeApptId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const result = checkInAppointment(db, {
      ticketId: 'tid-1',
      ticketNumber: 'G-001',
      officeId: OFFICE_ID,
      departmentId: DEPT_ID,
      appointmentId: fakeApptId,
    });

    // The kiosk server does NOT validate that the appointment exists in a local table
    // (appointments live in the cloud). It just creates the ticket with the appointment_id.
    expect(result.duplicate).toBe(false);
    expect(result.ticket.id).toBe('tid-1');

    const row = db.prepare("SELECT * FROM tickets WHERE id = 'tid-1'").get() as any;
    expect(row.appointment_id).toBe(fakeApptId);
  });
});
