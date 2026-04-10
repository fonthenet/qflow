-- ============================================================
-- Prevent duplicate tickets for the same appointment
-- ============================================================
-- A partial unique index ensures only ONE active ticket can exist
-- per appointment. Cancelled/no-show tickets are excluded so an
-- appointment can be re-checked-in after a no-show.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_appointment_unique
  ON tickets (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show');
