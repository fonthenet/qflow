-- Disable end-of-day auto-cancellation of waiting / called tickets for all
-- organizations (new and existing) by default. Customer requirement: a
-- ticket sitting in the queue must NEVER be auto-cancelled just because
-- the calendar rolled over — only operators decide who gets cancelled.
--
-- What this migration does:
--
--   1. `recover_stuck_tickets()` — rewritten to drop the "cancel
--      yesterday's waiting/called" block. Keeps:
--         • 15-min stale-called → waiting (ticket revert)
--         • 4-hour stale-serving → parked
--         • desk heartbeat offline detection
--         • desks whose heartbeat died → called tickets re-queued
--
--   2. `cleanup_stale_tickets()` — rewritten to drop the "cancel
--      waiting/called" block. Keeps the auto-complete of `serving`
--      tickets that never got a manual `completed` (handles "incomplete
--      ticket can be cleared" — a ticket the operator started but forgot
--      to complete becomes `served` at end of day, not `cancelled`).
--
--   3. Unschedules any pg_cron jobs whose command string references
--      "Auto-cancelled: end of day" — belt-and-braces in case an earlier
--      migration left a direct-cron variant running.
--
-- Nothing in this migration affects:
--   • Per-operation auto-cancel in Station's `call-next` handler
--     (local reconciliation when cloud marks a ticket cancelled)
--   • Manual cancel/no-show/serve actions
--   • Ticket revert (stale called → waiting)

CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb AS $$
DECLARE
  v_requeued int := 0;
  v_parked int := 0;
  v_desks_offlined int := 0;
  v_requeued_from_desks int := 0;
BEGIN
  -- Ticket revert: a `called` ticket the operator hasn't actioned in
  -- 15 minutes goes back to `waiting` so another desk can pick it up.
  WITH requeued AS (
    UPDATE tickets
    SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND called_at < now() - interval '15 minutes'
    RETURNING id
  ) SELECT count(*) INTO v_requeued FROM requeued;

  -- Park safety: a `serving` ticket open for 4+ hours is almost
  -- certainly a forgotten tab. Parking is non-destructive (the operator
  -- can resume from parked at any time).
  WITH parked AS (
    UPDATE tickets
    SET parked_at = now(),
        notes = COALESCE(notes, '') || ' [Auto-parked: 4h timeout]'
    WHERE status = 'serving'
      AND serving_started_at < now() - interval '4 hours'
      AND parked_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_parked FROM parked;

  -- Desk heartbeat: if a desk hasn't pinged in 3 minutes, mark it
  -- offline and re-queue any tickets it was currently calling so they
  -- aren't stuck on a dead desk.
  WITH stale_desks AS (
    UPDATE desk_heartbeats
    SET is_online = false
    WHERE last_ping < now() - interval '3 minutes' AND is_online = true
    RETURNING desk_id
  ),
  requeued_from_desks AS (
    UPDATE tickets
    SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND desk_id IN (SELECT desk_id FROM stale_desks)
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM stale_desks),
    (SELECT count(*) FROM requeued_from_desks)
  INTO v_desks_offlined, v_requeued_from_desks;

  -- NOTE: the previous "cancel yesterday's waiting/called" block was
  -- intentionally removed. Tickets in the queue are never auto-cancelled
  -- by this job. If a business needs that behavior they can opt in later
  -- via an explicit setting (not yet implemented).

  RETURN jsonb_build_object(
    'requeued_stale_called', v_requeued,
    'parked_stale_serving', v_parked,
    'cancelled_yesterday', 0,
    'desks_offlined', v_desks_offlined,
    'requeued_from_dead_desks', v_requeued_from_desks,
    'recovered_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- `cleanup_stale_tickets()` — drops the waiting/called cancel block but
-- keeps the serving → served auto-complete so "incomplete" tickets
-- (started but not finished) don't sit open indefinitely.
CREATE OR REPLACE FUNCTION cleanup_stale_tickets()
RETURNS integer AS $$
DECLARE
  v_completed int := 0;
BEGIN
  WITH completed AS (
    UPDATE tickets
    SET status = 'served',
        completed_at = now(),
        notes = COALESCE(notes, '') || ' [Auto-completed: end of day]'
    WHERE status = 'serving' AND created_at < CURRENT_DATE
    RETURNING id
  ) SELECT COUNT(*) INTO v_completed FROM completed;
  RETURN v_completed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Belt-and-braces: drop any lingering pg_cron job that auto-cancels
-- waiting/called tickets via an inline UPDATE (as opposed to calling
-- the RPCs above). Earlier migrations scheduled such jobs directly.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid, command
    FROM cron.job
    WHERE command ILIKE '%Auto-cancelled: end of day%'
       OR command ILIKE '%status = ''cancelled''%created_at < CURRENT_DATE%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
    RAISE NOTICE 'Unscheduled auto-cancel cron job %', j.jobid;
  END LOOP;
END $$;
