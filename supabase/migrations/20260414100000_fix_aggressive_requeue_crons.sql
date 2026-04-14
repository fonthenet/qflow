-- Fix aggressive requeue cron jobs that were destroying ticket state
-- The previous 2-minute / 90-second timeouts were far too short — a customer
-- may take 5-10 minutes to walk to the desk after being called. This caused:
--   1. Called tickets reverted to 'waiting' before the customer arrived
--   2. Desk capacity triggers blocking new calls (sync race conditions)
--   3. Cascading sync failures tripping the station's circuit breaker

-- 1. recover_stuck_tickets() — increase requeue timeout from 2 to 15 minutes
CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb AS $$
DECLARE
  v_requeued int := 0;
  v_parked int := 0;
  v_cancelled int := 0;
  v_desks_offlined int := 0;
BEGIN
  WITH requeued AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND called_at < now() - interval '15 minutes'
    RETURNING id
  ) SELECT count(*) INTO v_requeued FROM requeued;

  WITH parked AS (
    UPDATE tickets SET parked_at = now(), notes = COALESCE(notes, '') || ' [Auto-parked: 4h timeout]'
    WHERE status = 'serving' AND serving_started_at < now() - interval '4 hours' AND parked_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_parked FROM parked;

  WITH cancelled AS (
    UPDATE tickets t SET status = 'cancelled', completed_at = now(),
      notes = COALESCE(t.notes, '') || ' [Auto-cancelled: end of day]'
    FROM offices o
    WHERE t.office_id = o.id
      AND t.status IN ('waiting', 'called')
      AND t.created_at < (CURRENT_DATE AT TIME ZONE COALESCE(o.timezone, 'UTC'))::timestamptz
    RETURNING t.id
  ) SELECT count(*) INTO v_cancelled FROM cancelled;

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
    'cancelled_yesterday', v_cancelled, 'desks_offlined', v_desks_offlined, 'recovered_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. requeue_expired_calls() — increase default from 90s to 15 minutes
CREATE OR REPLACE FUNCTION requeue_expired_calls(p_timeout_seconds integer DEFAULT 900)
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

-- 3. Replace the 2-minute inline cron with a 15-minute version
-- (Old job 3 was: requeue after 2 min, every minute)
-- New: requeue after 15 min, every 5 minutes
SELECT cron.unschedule(j.jobid)
FROM cron.job j
WHERE j.command LIKE '%INTERVAL ''2 minutes''%'
  AND j.command LIKE '%status = ''called''%';

SELECT cron.schedule('requeue-stale-called-15min', '*/5 * * * *', $$
  UPDATE tickets
  SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
  WHERE status = 'called'
    AND called_at < NOW() - INTERVAL '15 minutes'
    AND created_at >= CURRENT_DATE;
$$);
