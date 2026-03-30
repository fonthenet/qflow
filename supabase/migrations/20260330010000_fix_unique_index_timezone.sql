-- Fix: unique index on ticket_number used utc_date() which caused collisions
-- after local midnight but before UTC midnight (e.g., 00:00-01:00 Africa/Algiers).
--
-- Ticket number generation (generate_daily_ticket_number) resets at LOCAL midnight,
-- but the unique index grouped by UTC date. So in the overlap window, new day's
-- tickets (HAD-0001, HAD-0002, ...) collided with same-UTC-day old tickets that
-- were served/no_show (not excluded by the WHERE status <> 'cancelled' filter).
--
-- The ticket_sequences table already guarantees unique numbers per department per
-- local date via ON CONFLICT, so this index was redundant and actively harmful.

-- Drop the broken UTC-based unique index
DROP INDEX IF EXISTS idx_tickets_unique_number_per_office_day;

-- Replace with a non-unique index for lookup performance only
CREATE INDEX IF NOT EXISTS idx_tickets_number_office
  ON tickets (office_id, ticket_number);
