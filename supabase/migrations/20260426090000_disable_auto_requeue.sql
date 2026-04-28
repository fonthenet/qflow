-- Disable auto-requeue of called tickets.
--
-- Both the 15-minute cron and the stale-desk branch in
-- recover_stuck_tickets() were yanking `called` tickets back to
-- `waiting` without warning. For restaurant takeouts on the queue
-- canvas this is destructive: `called` means "order is in the kitchen
-- pipeline", not "customer walked away from the desk". For other
-- verticals it is also routinely surprising — ops staff prefer to
-- explicitly No-Show / Cancel rather than have the system reset state.
--
-- This migration:
--   1. Unschedules the 15-min `requeue-stale-called` cron entirely.
--   2. Rewrites recover_stuck_tickets() to drop BOTH requeue branches.
--      We keep the other useful behaviours:
--        - auto-park serving > 4h
--        - mark stale desks offline (heartbeat > 3 min)
--        - end-of-day auto-cancel of yesterday's waiting/called rows
--           (in office-local timezone — the bug fixed in
--            20260420001500_fix_recover_stuck_tickets_tz.sql)
--   3. Drops requeue_expired_calls() and requeue_desk_tickets() since
--      nothing else should ever auto-requeue called tickets again.
--      (The triggers that called requeue_desk_tickets on desk
--      deactivation are removed too — operators can re-call manually.)

-- ── 1. Unschedule the cron ─────────────────────────────────────────
SELECT cron.unschedule(j.jobid)
FROM cron.job j
WHERE j.jobname = 'requeue-stale-called'
   OR j.jobname = 'requeue-stale-called-15min'
   OR (j.command ILIKE '%status = ''called''%'
       AND j.command ILIKE '%status = ''waiting''%'
       AND j.command ILIKE '%called_at <%');

-- ── 2. Rewrite recover_stuck_tickets() without requeue branches ────
CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb AS $$
DECLARE
  v_parked int := 0;
  v_cancelled int := 0;
  v_desks_offlined int := 0;
BEGIN
  -- Auto-park serving tickets that have been open for more than 4 hours.
  -- A `serving` ticket > 4h almost always means the operator forgot to
  -- complete it — parking is non-destructive (it stays visible) and
  -- frees the desk capacity counter.
  WITH parked AS (
    UPDATE tickets SET parked_at = now(), notes = COALESCE(notes, '') || ' [Auto-parked: 4h timeout]'
    WHERE status = 'serving' AND serving_started_at < now() - interval '4 hours' AND parked_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_parked FROM parked;

  -- Cancel yesterday's waiting/called tickets at office-local midnight.
  WITH cancelled AS (
    UPDATE tickets t SET status = 'cancelled', completed_at = now(),
      notes = COALESCE(t.notes, '') || ' [Auto-cancelled: end of day]'
    FROM offices o
    WHERE t.office_id = o.id
      AND t.status IN ('waiting', 'called')
      AND t.created_at < (
        (now() AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date::timestamp
        AT TIME ZONE COALESCE(o.timezone, 'UTC')
      )
    RETURNING t.id, t.status AS from_status
  ),
  log AS (
    INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, metadata)
    SELECT id, 'cancelled', from_status, 'cancelled',
           jsonb_build_object('source', 'recover_stuck_tickets', 'reason', 'end_of_day')
    FROM cancelled
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  -- Flag desks whose Station hasn't pinged in > 3 minutes as offline,
  -- but DO NOT touch their called tickets. Operators can re-call manually.
  WITH stale_desks AS (
    UPDATE desk_heartbeats SET is_online = false
    WHERE last_ping < now() - interval '3 minutes' AND is_online = true
    RETURNING desk_id
  ) SELECT count(*) INTO v_desks_offlined FROM stale_desks;

  RETURN jsonb_build_object(
    'requeued_stale_called', 0,
    'parked_stale_serving', v_parked,
    'cancelled_yesterday', v_cancelled,
    'desks_offlined', v_desks_offlined,
    'recovered_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Remove the now-unused auto-requeue helpers + triggers ───────
DROP TRIGGER IF EXISTS desk_deactivated_requeue ON desks;
DROP FUNCTION IF EXISTS trigger_desk_deactivated() CASCADE;
DROP FUNCTION IF EXISTS requeue_desk_tickets(uuid);
DROP FUNCTION IF EXISTS requeue_expired_calls(integer);
