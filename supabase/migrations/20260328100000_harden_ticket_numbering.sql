-- ============================================================
-- Harden Ticket Numbering System
-- ============================================================
-- Fix 1: Timezone-aware daily sequence reset (uses office TZ)
-- Fix 2: 4-digit padding (supports 0001-9999 tickets/dept/day)
-- Fix 3: Partial unique index + dedup of historical duplicates
-- Fix 4: Canonical get_queue_position (priority + parked aware)
-- Fix 5: Timezone-aware end-of-day cleanup
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FIX 1+2: Timezone-aware + 4-digit ticket number generation
-- ────────────────────────────────────────────────────────────

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
  v_tz        text;
  v_local_date date;
BEGIN
  SELECT d.code, d.office_id
    INTO v_dept_code, v_office_id
    FROM departments d
   WHERE d.id = p_department_id;

  IF v_dept_code IS NULL THEN
    RAISE EXCEPTION 'Department not found: %', p_department_id;
  END IF;

  SELECT COALESCE(o.timezone, 'UTC')
    INTO v_tz
    FROM offices o
   WHERE o.id = v_office_id;

  v_tz := COALESCE(v_tz, 'UTC');
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  INSERT INTO ticket_sequences (department_id, seq_date, last_sequence)
  VALUES (p_department_id, v_local_date, 1)
  ON CONFLICT (department_id, seq_date)
  DO UPDATE SET last_sequence = ticket_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_seq;

  ticket_num := v_dept_code || '-' || LPAD(v_seq::text, 4, '0');
  seq := v_seq;
  RETURN NEXT;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- FIX 3: Unique ticket number guard
-- ────────────────────────────────────────────────────────────

-- Immutable helper for index expressions
CREATE OR REPLACE FUNCTION public.utc_date(ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$ SELECT (ts AT TIME ZONE 'UTC')::date $$;

-- Deduplicate existing tickets (keep oldest, cancel newer dupes)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY office_id, department_id, ticket_number, public.utc_date(created_at)
           ORDER BY created_at ASC
         ) AS rn
    FROM tickets
   WHERE status != 'cancelled'
)
UPDATE tickets
   SET status = 'cancelled',
       notes = COALESCE(notes, '') || ' [Deduped: duplicate ticket_number]'
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Unique index: one ticket_number per office per day (non-cancelled)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_unique_number_per_office_day
  ON tickets (office_id, ticket_number, utc_date(created_at))
  WHERE status != 'cancelled';

-- ────────────────────────────────────────────────────────────
-- FIX 4: Canonical get_queue_position (priority + parked aware)
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_queue_position(uuid);

CREATE OR REPLACE FUNCTION get_queue_position(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket  tickets%ROWTYPE;
  v_position integer;
  v_total    integer;
  v_est_wait numeric;
  v_avg_time numeric;
  v_now_serving text;
BEGIN
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  IF v_ticket IS NULL THEN
    RETURN jsonb_build_object('error', 'Ticket not found');
  END IF;
  IF v_ticket.status != 'waiting' THEN
    RETURN jsonb_build_object(
      'position', NULL, 'total_waiting', 0,
      'estimated_wait_minutes', NULL, 'now_serving', NULL
    );
  END IF;

  SELECT COUNT(*) + 1 INTO v_position
    FROM tickets
   WHERE office_id = v_ticket.office_id
     AND department_id = v_ticket.department_id
     AND status = 'waiting'
     AND parked_at IS NULL
     AND id != p_ticket_id
     AND (
           priority > COALESCE(v_ticket.priority, 0)
        OR (priority = COALESCE(v_ticket.priority, 0) AND created_at < v_ticket.created_at)
     );

  SELECT COUNT(*) INTO v_total
    FROM tickets
   WHERE office_id = v_ticket.office_id
     AND department_id = v_ticket.department_id
     AND status = 'waiting' AND parked_at IS NULL;

  SELECT AVG(EXTRACT(EPOCH FROM (completed_at - serving_started_at)) / 60)
    INTO v_avg_time
    FROM (
      SELECT completed_at, serving_started_at FROM tickets
       WHERE department_id = v_ticket.department_id AND office_id = v_ticket.office_id
         AND status = 'served' AND completed_at IS NOT NULL AND serving_started_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 50
    ) recent;

  IF v_avg_time IS NULL OR v_avg_time <= 0 THEN v_avg_time := 5; END IF;
  v_est_wait := CEIL((v_position - 1) * v_avg_time);

  SELECT ticket_number INTO v_now_serving
    FROM tickets
   WHERE department_id = v_ticket.department_id AND office_id = v_ticket.office_id
     AND status IN ('serving', 'called')
   ORDER BY called_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'position', v_position, 'total_waiting', v_total,
    'estimated_wait_minutes', v_est_wait, 'now_serving', v_now_serving
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_queue_position(uuid) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- FIX 5: Timezone-aware recovery + cleanup
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued int := 0; v_parked int := 0;
  v_cancelled int := 0; v_desks_offlined int := 0;
BEGIN
  WITH requeued AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
     WHERE status = 'called' AND called_at < now() - interval '2 minutes'
    RETURNING id
  ) SELECT count(*) INTO v_requeued FROM requeued;

  WITH parked AS (
    UPDATE tickets SET parked_at = now(), notes = COALESCE(notes, '') || ' [Auto-parked: 4h timeout]'
     WHERE status = 'serving' AND serving_started_at < now() - interval '4 hours' AND parked_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_parked FROM parked;

  WITH stale AS (
    UPDATE tickets t
       SET status = 'cancelled',
           notes = COALESCE(t.notes, '') || ' [Auto-cancelled: end of day]'
      FROM offices o
     WHERE t.office_id = o.id
       AND t.status IN ('waiting', 'called')
       AND t.created_at < (
             (now() AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date
           )::timestamptz AT TIME ZONE COALESCE(o.timezone, 'UTC')
    RETURNING t.id
  ) SELECT count(*) INTO v_cancelled FROM stale;

  WITH stale_desks AS (
    UPDATE desk_heartbeats SET is_online = false
     WHERE last_ping < now() - interval '3 minutes' AND is_online = true
    RETURNING desk_id
  ),
  requeued_from_desks AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
     WHERE status = 'called' AND desk_id IN (SELECT desk_id FROM stale_desks)
    RETURNING id
  ) SELECT count(*) INTO v_desks_offlined FROM stale_desks;

  RETURN jsonb_build_object(
    'requeued_stale_called', v_requeued, 'parked_stale_serving', v_parked,
    'cancelled_yesterday', v_cancelled, 'desks_offlined', v_desks_offlined,
    'recovered_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_stale_tickets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  WITH stale AS (
    UPDATE tickets t
       SET status = 'cancelled',
           notes = COALESCE(t.notes, '') || ' [Auto-cancelled: end of day]'
      FROM offices o
     WHERE t.office_id = o.id
       AND t.status IN ('waiting', 'called')
       AND t.created_at < (
             (now() AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date
           )::timestamptz AT TIME ZONE COALESCE(o.timezone, 'UTC')
    RETURNING t.id
  ) SELECT count(*) INTO v_count FROM stale;

  UPDATE tickets t
     SET status = 'served', completed_at = now(),
         notes = COALESCE(t.notes, '') || ' [Auto-completed: end of day]'
    FROM offices o
   WHERE t.office_id = o.id AND t.status = 'serving'
     AND t.created_at < (
           (now() AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date
         )::timestamptz AT TIME ZONE COALESCE(o.timezone, 'UTC');

  RETURN v_count;
END;
$$;
