-- ============================================
-- Canonical queue position calculation
-- SINGLE SOURCE OF TRUTH for all queue positions
-- ============================================
-- Rules:
--   1. Position is DEPARTMENT-scoped (same office + same department)
--   2. Only 'waiting' tickets count (parked tickets excluded)
--   3. Ordering: priority DESC (higher = served first), then created_at ASC (FIFO)
--   4. Position is 1-based (1 = next to be called)
--   5. Estimated wait = (position - 1) * avg service time
--   6. Now serving = most recently called/serving ticket in the department
-- ============================================

CREATE OR REPLACE FUNCTION get_queue_position(p_ticket_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_ticket tickets%ROWTYPE;
  v_position integer;
  v_total integer;
  v_est_wait numeric;
  v_avg_service_time numeric;
  v_now_serving text;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('error', 'Ticket not found');
  END IF;

  IF v_ticket.status != 'waiting' THEN
    RETURN jsonb_build_object(
      'position', NULL,
      'total_waiting', 0,
      'estimated_wait_minutes', NULL,
      'now_serving', NULL
    );
  END IF;

  -- Position: count tickets ahead in same department
  -- Ahead = higher priority OR (same priority AND created earlier)
  SELECT COUNT(*) + 1 INTO v_position
  FROM tickets
  WHERE office_id = v_ticket.office_id
    AND department_id = v_ticket.department_id
    AND status = 'waiting'
    AND parked_at IS NULL
    AND id != p_ticket_id
    AND (
      priority > COALESCE(v_ticket.priority, 0)
      OR (
        priority = COALESCE(v_ticket.priority, 0)
        AND created_at < v_ticket.created_at
      )
    );

  -- Total waiting in department (excluding parked)
  SELECT COUNT(*) INTO v_total
  FROM tickets
  WHERE office_id = v_ticket.office_id
    AND department_id = v_ticket.department_id
    AND status = 'waiting'
    AND parked_at IS NULL;

  -- Average service time from last 50 completed tickets in department
  SELECT AVG(EXTRACT(EPOCH FROM (completed_at - serving_started_at)) / 60)
  INTO v_avg_service_time
  FROM (
    SELECT completed_at, serving_started_at
    FROM tickets
    WHERE department_id = v_ticket.department_id
      AND office_id = v_ticket.office_id
      AND status = 'served'
      AND completed_at IS NOT NULL
      AND serving_started_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 50
  ) recent;

  IF v_avg_service_time IS NULL OR v_avg_service_time <= 0 THEN
    v_avg_service_time := 5;
  END IF;

  v_est_wait := CEIL((v_position - 1) * v_avg_service_time);

  -- Currently serving/called ticket in department
  SELECT ticket_number INTO v_now_serving
  FROM tickets
  WHERE department_id = v_ticket.department_id
    AND office_id = v_ticket.office_id
    AND status IN ('serving', 'called')
  ORDER BY called_at DESC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'position', v_position,
    'total_waiting', v_total,
    'estimated_wait_minutes', v_est_wait,
    'now_serving', v_now_serving
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_queue_position(uuid) TO anon, authenticated, service_role;
