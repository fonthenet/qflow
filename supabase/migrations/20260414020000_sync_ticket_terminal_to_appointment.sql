-- Unified trigger: sync ticket status → linked appointment.
-- Keeps the calendar view in perfect sync with queue actions.
--
-- Handles ALL significant ticket transitions:
--   called   → appointment.called
--   serving  → appointment.serving
--   served   → appointment.completed
--   no_show  → appointment.no_show
--   cancelled → appointment.cancelled
--
-- Checks BOTH link directions:
--   ticket.appointment_id → appointment
--   appointment.ticket_id → ticket
--
-- This is the single source of truth for ticket↔appointment sync.
-- App-level code (onTicketTerminal, ticket-transition) also syncs,
-- but this trigger is the safety net that always works.

CREATE OR REPLACE FUNCTION sync_ticket_status_to_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_appt_status text;
  v_active_states text[];
BEGIN
  -- Only fire on actual status change
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map ticket status → appointment status
  v_appt_status := CASE NEW.status
    WHEN 'called'    THEN 'called'
    WHEN 'serving'   THEN 'serving'
    WHEN 'served'    THEN 'completed'
    WHEN 'no_show'   THEN 'no_show'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE NULL
  END;

  IF v_appt_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Which appointment states can transition from depends on the new status
  IF NEW.status IN ('served', 'no_show', 'cancelled') THEN
    -- Terminal: can override any active appointment state
    v_active_states := ARRAY['pending', 'confirmed', 'checked_in', 'called', 'serving'];
  ELSIF NEW.status = 'serving' THEN
    v_active_states := ARRAY['checked_in', 'called'];
  ELSIF NEW.status = 'called' THEN
    v_active_states := ARRAY['checked_in'];
  ELSE
    RETURN NEW;
  END IF;

  -- Direction 1: ticket.appointment_id → appointment
  IF NEW.appointment_id IS NOT NULL THEN
    UPDATE appointments
    SET status = v_appt_status,
        notes = COALESCE(NEW.notes, appointments.notes),
        updated_at = now()
    WHERE id = NEW.appointment_id
      AND status = ANY(v_active_states);
  END IF;

  -- Direction 2: appointment.ticket_id → ticket (reverse link)
  UPDATE appointments
  SET status = v_appt_status,
      notes = COALESCE(NEW.notes, appointments.notes),
      updated_at = now()
  WHERE ticket_id = NEW.id
    AND status = ANY(v_active_states);

  RETURN NEW;
END;
$$;

-- Replace old trigger (if any name variant exists)
DROP TRIGGER IF EXISTS trg_sync_ticket_terminal_to_appointment ON tickets;
DROP TRIGGER IF EXISTS trg_sync_ticket_status_to_appointment ON tickets;
CREATE TRIGGER trg_sync_ticket_status_to_appointment
  AFTER UPDATE ON tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_ticket_status_to_appointment();
