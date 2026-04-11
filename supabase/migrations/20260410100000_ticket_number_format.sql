-- ============================================================
-- Ticket Number Format: respect org-level prefix + format settings
-- ============================================================
-- Settings in organizations.settings JSON:
--   ticket_number_prefix  (text, e.g. 'TK-')
--   ticket_number_format  (text: 'dept_numeric' | 'prefix_numeric' | 'prefix_dept_numeric')
--
-- Formats:
--   dept_numeric          → G-0001        (default, current behavior)
--   prefix_numeric        → TK-0001       (prefix + sequence, no dept code)
--   prefix_dept_numeric   → TK-G-0001     (prefix + dept + sequence)

CREATE OR REPLACE FUNCTION public.generate_daily_ticket_number(p_department_id uuid)
RETURNS TABLE(ticket_num text, seq integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept_code text;
  v_seq       integer;
  v_office_id uuid;
  v_org_id    uuid;
  v_tz        text;
  v_prefix    text;
  v_format    text;
BEGIN
  SELECT d.code, d.office_id
    INTO v_dept_code, v_office_id
    FROM departments d
   WHERE d.id = p_department_id;

  IF v_dept_code IS NULL THEN
    RAISE EXCEPTION 'Department not found: %', p_department_id;
  END IF;

  -- Get timezone + org_id
  SELECT COALESCE(o.timezone, 'UTC'), o.organization_id
    INTO v_tz, v_org_id
    FROM offices o
   WHERE o.id = v_office_id;

  v_tz := COALESCE(v_tz, 'UTC');

  -- Get org settings for prefix + format
  SELECT
    COALESCE(org.settings->>'ticket_number_prefix', ''),
    COALESCE(org.settings->>'ticket_number_format', 'dept_numeric')
    INTO v_prefix, v_format
    FROM organizations org
   WHERE org.id = v_org_id;

  v_prefix := COALESCE(v_prefix, '');
  v_format := COALESCE(v_format, 'dept_numeric');

  -- Atomic sequence increment (PK is department_id only, no date)
  INSERT INTO ticket_sequences (department_id, last_sequence)
  VALUES (p_department_id, 1)
  ON CONFLICT (department_id)
  DO UPDATE SET last_sequence = ticket_sequences.last_sequence + 1,
                updated_at = now()
  RETURNING last_sequence INTO v_seq;

  -- Format ticket number based on setting
  CASE v_format
    WHEN 'prefix_numeric' THEN
      -- TK-0001 (prefix + sequence only, no dept code)
      ticket_num := v_prefix || LPAD(v_seq::text, 4, '0');
    WHEN 'prefix_dept_numeric' THEN
      -- TK-G-0001 (prefix + dept + sequence)
      ticket_num := v_prefix || v_dept_code || '-' || LPAD(v_seq::text, 4, '0');
    ELSE
      -- dept_numeric (default): G-0001
      ticket_num := v_dept_code || '-' || LPAD(v_seq::text, 4, '0');
  END CASE;

  seq := v_seq;
  RETURN NEXT;
END;
$$;

-- Ensure all roles can call this SECURITY DEFINER function (anon key needs it for offline-first kiosk path)
GRANT EXECUTE ON FUNCTION public.generate_daily_ticket_number(uuid) TO anon, authenticated, service_role;
