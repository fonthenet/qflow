-- Fix timezone midnight calculation bug in recover_stuck_tickets() and cleanup_stale_tickets()
--
-- Bug: The expression ((now() AT TIME ZONE tz)::date)::timestamptz AT TIME ZONE tz
-- returns a timestamp WITHOUT timezone, which when compared with timestamptz gets
-- interpreted as UTC — causing a 2-hour offset for UTC+1 timezones like Africa/Algiers.
-- Between 00:00–02:00 local time, every new ticket was immediately auto-cancelled.
--
-- Fix: Use date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz which returns
-- a proper timestamptz representing midnight in the office timezone.

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

  -- Fixed: use date_trunc to correctly compute midnight in office timezone
  WITH stale AS (
    UPDATE tickets t
       SET status = 'cancelled',
           notes = COALESCE(t.notes, '') || ' [Auto-cancelled: end of day]'
      FROM offices o
     WHERE t.office_id = o.id
       AND t.status IN ('waiting', 'called')
       AND t.created_at < date_trunc('day', now() AT TIME ZONE COALESCE(o.timezone, 'UTC')) AT TIME ZONE COALESCE(o.timezone, 'UTC')
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
       AND t.created_at < date_trunc('day', now() AT TIME ZONE COALESCE(o.timezone, 'UTC')) AT TIME ZONE COALESCE(o.timezone, 'UTC')
    RETURNING t.id
  ) SELECT count(*) INTO v_count FROM stale;

  UPDATE tickets t
     SET status = 'served', completed_at = now(),
         notes = COALESCE(t.notes, '') || ' [Auto-completed: end of day]'
    FROM offices o
   WHERE t.office_id = o.id AND t.status = 'serving'
     AND t.created_at < date_trunc('day', now() AT TIME ZONE COALESCE(o.timezone, 'UTC')) AT TIME ZONE COALESCE(o.timezone, 'UTC');

  RETURN v_count;
END;
$$;
