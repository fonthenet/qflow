-- Queue Safety Nets Migration
-- Applied via Supabase MCP on 2026-03-18

-- 1. CALL TIMEOUT: Auto-requeue called tickets after 90 seconds
CREATE OR REPLACE FUNCTION requeue_expired_calls(p_timeout_seconds integer DEFAULT 90)
RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND called_at < now() - (p_timeout_seconds || ' seconds')::interval
    RETURNING id
  ) SELECT COUNT(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. DESK OFFLINE REQUEUE
CREATE OR REPLACE FUNCTION requeue_desk_tickets(p_desk_id uuid) RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH requeued AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL, serving_started_at = NULL
    WHERE desk_id = p_desk_id AND status IN ('called', 'serving') RETURNING id
  ) SELECT COUNT(*) INTO v_count FROM requeued;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: auto-requeue when desk deactivated
CREATE OR REPLACE FUNCTION trigger_desk_deactivated() RETURNS trigger AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN PERFORM requeue_desk_tickets(NEW.id); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS desk_deactivated_requeue ON desks;
CREATE TRIGGER desk_deactivated_requeue AFTER UPDATE OF is_active ON desks FOR EACH ROW EXECUTE FUNCTION trigger_desk_deactivated();

-- 3. ONE-TICKET-PER-DESK GUARD
CREATE OR REPLACE FUNCTION check_desk_capacity() RETURNS trigger AS $$
DECLARE v_active_count integer;
BEGIN
  IF NEW.desk_id IS NOT NULL AND NEW.status IN ('called', 'serving') THEN
    SELECT COUNT(*) INTO v_active_count FROM tickets WHERE desk_id = NEW.desk_id AND status IN ('called', 'serving') AND id != NEW.id;
    IF v_active_count > 0 THEN RAISE EXCEPTION 'Desk already has an active ticket.'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS enforce_desk_capacity ON tickets;
CREATE TRIGGER enforce_desk_capacity BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION check_desk_capacity();

-- 4. DESK HEARTBEAT columns
ALTER TABLE desks ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();
ALTER TABLE desks ADD COLUMN IF NOT EXISTS paused_at timestamptz;

-- Park tickets on inactive desks
CREATE OR REPLACE FUNCTION park_inactive_desk_tickets(p_timeout_minutes integer DEFAULT 5) RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH inactive_desks AS (
    SELECT id FROM desks WHERE is_active = true AND last_active_at < now() - (p_timeout_minutes || ' minutes')::interval
  ), parked AS (
    UPDATE tickets t SET parked_at = now(), notes = COALESCE(notes, '') || ' [Auto-parked: desk inactive]'
    FROM inactive_desks d WHERE t.desk_id = d.id AND t.status = 'serving' RETURNING t.id
  ) SELECT COUNT(*) INTO v_count FROM parked;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. TIME-AWARE BOOKING PRIORITY
CREATE OR REPLACE FUNCTION adjust_booking_priorities() RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH updated AS (
    UPDATE tickets t SET priority = CASE
      WHEN a.scheduled_at <= now() THEN 7
      WHEN a.scheduled_at <= now() + interval '15 minutes' THEN 5
      ELSE 1
    END
    FROM appointments a WHERE t.appointment_id = a.id AND t.status = 'waiting'
      AND t.priority != CASE WHEN a.scheduled_at <= now() THEN 7 WHEN a.scheduled_at <= now() + interval '15 minutes' THEN 5 ELSE 1 END
    RETURNING t.id
  ) SELECT COUNT(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. END-OF-DAY CLEANUP
CREATE OR REPLACE FUNCTION cleanup_stale_tickets() RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH stale AS (
    UPDATE tickets SET status = 'cancelled', notes = COALESCE(notes, '') || ' [Auto-cancelled: end of day]'
    WHERE status IN ('waiting', 'called') AND created_at < CURRENT_DATE RETURNING id
  ) SELECT COUNT(*) INTO v_count FROM stale;
  UPDATE tickets SET status = 'served', completed_at = now(), notes = COALESCE(notes, '') || ' [Auto-completed: end of day]'
  WHERE status = 'serving' AND created_at < CURRENT_DATE;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. VIP PRIORITY CAP (0-10)
CREATE OR REPLACE FUNCTION cap_ticket_priority() RETURNS trigger AS $$
BEGIN
  IF NEW.priority > 10 THEN NEW.priority := 10; END IF;
  IF NEW.priority < 0 THEN NEW.priority := 0; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cap_priority ON tickets;
CREATE TRIGGER cap_priority BEFORE INSERT OR UPDATE OF priority ON tickets FOR EACH ROW EXECUTE FUNCTION cap_ticket_priority();

-- 8. CROSS-SERVICE OVERFLOW
CREATE OR REPLACE FUNCTION call_next_ticket_with_overflow(p_desk_id uuid, p_staff_id uuid) RETURNS uuid AS $$
DECLARE v_ticket_id uuid; v_desk desks%ROWTYPE;
BEGIN
  SELECT * INTO v_desk FROM desks WHERE id = p_desk_id;
  IF v_desk IS NULL THEN RAISE EXCEPTION 'Desk not found'; END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE desk_id = p_desk_id AND status IN ('called', 'serving')) THEN
    RAISE EXCEPTION 'Desk already has an active ticket';
  END IF;
  -- Step 1: desk's services
  SELECT t.id INTO v_ticket_id FROM tickets t
  INNER JOIN desk_services ds ON ds.service_id = t.service_id AND ds.desk_id = p_desk_id
  WHERE t.department_id = v_desk.department_id AND t.status = 'waiting' AND t.parked_at IS NULL
  ORDER BY t.priority DESC, t.created_at ASC LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  -- Step 2: any service in dept
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id FROM tickets t
    WHERE t.department_id = v_desk.department_id AND t.office_id = v_desk.office_id AND t.status = 'waiting' AND t.parked_at IS NULL
    ORDER BY t.priority DESC, t.created_at ASC LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  END IF;
  -- Step 3: any service in office
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id FROM tickets t
    WHERE t.office_id = v_desk.office_id AND t.status = 'waiting' AND t.parked_at IS NULL
    ORDER BY t.priority DESC, t.created_at ASC LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NULL; END IF;
  UPDATE tickets SET status = 'called', desk_id = p_desk_id, called_by_staff_id = p_staff_id, called_at = now() WHERE id = v_ticket_id;
  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. SERVICE ROUND-ROBIN
ALTER TABLE desks ADD COLUMN IF NOT EXISTS last_called_service_id uuid;

CREATE OR REPLACE FUNCTION call_next_ticket_round_robin(p_desk_id uuid, p_staff_id uuid) RETURNS uuid AS $$
DECLARE v_ticket_id uuid; v_desk desks%ROWTYPE; v_service_ids uuid[]; v_try_service uuid;
BEGIN
  SELECT * INTO v_desk FROM desks WHERE id = p_desk_id;
  IF v_desk IS NULL THEN RAISE EXCEPTION 'Desk not found'; END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE desk_id = p_desk_id AND status IN ('called', 'serving')) THEN
    RAISE EXCEPTION 'Desk already has an active ticket';
  END IF;
  SELECT array_agg(service_id) INTO v_service_ids FROM desk_services WHERE desk_id = p_desk_id;
  IF v_service_ids IS NULL OR array_length(v_service_ids, 1) = 0 THEN RETURN NULL; END IF;
  FOR v_try_service IN SELECT unnest(v_service_ids) ORDER BY (unnest(v_service_ids) = v_desk.last_called_service_id)::int, random()
  LOOP
    SELECT t.id INTO v_ticket_id FROM tickets t
    WHERE t.department_id = v_desk.department_id AND t.service_id = v_try_service AND t.status = 'waiting' AND t.parked_at IS NULL
    ORDER BY t.priority DESC, t.created_at ASC LIMIT 1 FOR UPDATE OF t SKIP LOCKED;
    IF v_ticket_id IS NOT NULL THEN
      UPDATE tickets SET status = 'called', desk_id = p_desk_id, called_by_staff_id = p_staff_id, called_at = now() WHERE id = v_ticket_id;
      UPDATE desks SET last_called_service_id = v_try_service WHERE id = p_desk_id;
      RETURN v_ticket_id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
