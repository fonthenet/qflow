
-- ============================================
-- Generate daily ticket number (atomic)
-- ============================================
CREATE OR REPLACE FUNCTION generate_daily_ticket_number(
  p_department_id uuid
)
RETURNS TABLE(ticket_num text, seq integer) AS $$
DECLARE
  v_dept_code text;
  v_seq integer;
BEGIN
  -- Get department code
  SELECT code INTO v_dept_code FROM departments WHERE id = p_department_id;
  
  -- Upsert and lock the sequence row
  INSERT INTO ticket_sequences (department_id, seq_date, last_sequence)
  VALUES (p_department_id, CURRENT_DATE, 1)
  ON CONFLICT (department_id, seq_date)
  DO UPDATE SET last_sequence = ticket_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;
  
  -- Return formatted ticket number
  ticket_num := v_dept_code || '-' || LPAD(v_seq::text, 3, '0');
  seq := v_seq;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Get queue position for a ticket
-- ============================================
CREATE OR REPLACE FUNCTION get_queue_position(p_ticket_id uuid)
RETURNS integer AS $$
DECLARE
  v_position integer;
  v_ticket tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  
  IF v_ticket IS NULL OR v_ticket.status NOT IN ('waiting', 'issued') THEN
    RETURN 0;
  END IF;
  
  SELECT COUNT(*) INTO v_position
  FROM tickets
  WHERE department_id = v_ticket.department_id
    AND status IN ('waiting')
    AND created_at < v_ticket.created_at
    AND id != v_ticket.id;
  
  RETURN v_position + 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Estimate wait time
-- ============================================
CREATE OR REPLACE FUNCTION estimate_wait_time(
  p_department_id uuid,
  p_service_id uuid
)
RETURNS integer AS $$
DECLARE
  v_avg_time numeric;
  v_queue_size integer;
  v_default_time integer;
BEGIN
  -- Get default estimated time from service
  SELECT estimated_service_time INTO v_default_time
  FROM services WHERE id = p_service_id;
  
  -- Calculate rolling average from last 50 completed tickets
  SELECT AVG(EXTRACT(EPOCH FROM (completed_at - serving_started_at)) / 60)
  INTO v_avg_time
  FROM (
    SELECT completed_at, serving_started_at
    FROM tickets
    WHERE department_id = p_department_id
      AND status = 'served'
      AND completed_at IS NOT NULL
      AND serving_started_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 50
  ) recent;
  
  -- Fall back to default if no history
  IF v_avg_time IS NULL THEN
    v_avg_time := COALESCE(v_default_time, 10);
  END IF;
  
  -- Count waiting tickets
  SELECT COUNT(*) INTO v_queue_size
  FROM tickets
  WHERE department_id = p_department_id
    AND status IN ('waiting');
  
  RETURN CEIL(v_queue_size * v_avg_time);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Call next ticket (concurrency-safe)
-- ============================================
CREATE OR REPLACE FUNCTION call_next_ticket(
  p_desk_id uuid,
  p_staff_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_ticket_id uuid;
  v_desk desks%ROWTYPE;
  v_old_status text;
BEGIN
  -- Get desk info
  SELECT * INTO v_desk FROM desks WHERE id = p_desk_id;
  
  IF v_desk IS NULL THEN
    RAISE EXCEPTION 'Desk not found';
  END IF;
  
  -- Find next ticket: priority first, then FIFO
  -- Only pick from services this desk handles
  SELECT t.id INTO v_ticket_id
  FROM tickets t
  INNER JOIN desk_services ds ON ds.service_id = t.service_id AND ds.desk_id = p_desk_id
  WHERE t.department_id = v_desk.department_id
    AND t.status = 'waiting'
  ORDER BY t.priority DESC, t.created_at ASC
  LIMIT 1
  FOR UPDATE OF t SKIP LOCKED;
  
  IF v_ticket_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Update ticket
  UPDATE tickets
  SET status = 'called',
      desk_id = p_desk_id,
      called_by_staff_id = p_staff_id,
      called_at = now()
  WHERE id = v_ticket_id
  RETURNING status INTO v_old_status;
  
  -- Log event
  INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, staff_id, desk_id)
  VALUES (v_ticket_id, 'called', 'waiting', 'called', p_staff_id, p_desk_id);
  
  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create organization with admin (for registration)
-- ============================================
CREATE OR REPLACE FUNCTION create_organization_with_admin(
  p_org_name text,
  p_org_slug text,
  p_admin_name text,
  p_admin_email text,
  p_auth_user_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Create organization
  INSERT INTO organizations (name, slug)
  VALUES (p_org_name, p_org_slug)
  RETURNING id INTO v_org_id;
  
  -- Create admin staff record
  INSERT INTO staff (auth_user_id, organization_id, full_name, email, role)
  VALUES (p_auth_user_id, v_org_id, p_admin_name, p_admin_email, 'admin');
  
  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql;
;
