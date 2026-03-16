
-- Fix call_next_ticket
CREATE OR REPLACE FUNCTION public.call_next_ticket(p_desk_id uuid, p_staff_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_desk desks%ROWTYPE;
  v_old_status text;
BEGIN
  SELECT * INTO v_desk FROM desks WHERE id = p_desk_id;
  IF v_desk IS NULL THEN
    RAISE EXCEPTION 'Desk not found';
  END IF;

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

  UPDATE tickets
  SET status = 'called',
      desk_id = p_desk_id,
      called_by_staff_id = p_staff_id,
      called_at = now()
  WHERE id = v_ticket_id
  RETURNING status INTO v_old_status;

  INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, staff_id, desk_id)
  VALUES (v_ticket_id, 'called', 'waiting', 'called', p_staff_id, p_desk_id);

  RETURN v_ticket_id;
END;
$$;

-- Fix generate_daily_ticket_number
CREATE OR REPLACE FUNCTION public.generate_daily_ticket_number(p_department_id uuid)
RETURNS TABLE(ticket_num text, seq integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept_code text;
  v_seq integer;
BEGIN
  SELECT code INTO v_dept_code FROM departments WHERE id = p_department_id;

  INSERT INTO ticket_sequences (department_id, seq_date, last_sequence)
  VALUES (p_department_id, CURRENT_DATE, 1)
  ON CONFLICT (department_id, seq_date)
  DO UPDATE SET last_sequence = ticket_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  ticket_num := v_dept_code || '-' || LPAD(v_seq::text, 3, '0');
  seq := v_seq;
  RETURN NEXT;
END;
$$;

-- Fix estimate_wait_time
CREATE OR REPLACE FUNCTION public.estimate_wait_time(p_department_id uuid, p_service_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg_time numeric;
  v_queue_size integer;
  v_default_time integer;
BEGIN
  SELECT estimated_service_time INTO v_default_time
  FROM services WHERE id = p_service_id;

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

  IF v_avg_time IS NULL THEN
    v_avg_time := COALESCE(v_default_time, 10);
  END IF;

  SELECT COUNT(*) INTO v_queue_size
  FROM tickets
  WHERE department_id = p_department_id
    AND status IN ('waiting');

  RETURN CEIL(v_queue_size * v_avg_time);
END;
$$;

-- Fix get_queue_position
CREATE OR REPLACE FUNCTION public.get_queue_position(p_ticket_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
;
