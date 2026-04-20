-- Fix recover_stuck_tickets() timezone bug that was cancelling fresh tickets.
--
-- The previous expression:
--   t.created_at < (CURRENT_DATE AT TIME ZONE COALESCE(o.timezone,'UTC'))::timestamptz
-- interprets `CURRENT_DATE` (server UTC date, e.g. 2026-04-20) as a naive
-- timestamp and then re-anchors it into the office timezone, which produces
-- the WRONG cutoff for offices east of UTC. For Africa/Algiers (UTC+1),
-- the cutoff came out as 2026-04-20 01:00 UTC instead of 2026-04-19 23:00
-- UTC — so every ticket created between 00:00 and 01:00 UTC was flagged as
-- "yesterday" and auto-cancelled within seconds of creation.
--
-- Observed fallout: WhatsApp JOIN tickets R-0070/71/72 on Restaurant DZD
-- got set to 'cancelled' with completed_at ~12s after creation, with no
-- ticket_events row (this function never wrote one — also fixed below).
--
-- Correct cutoff: the office-local midnight of "today in the office tz".
--   (now() AT TIME ZONE tz)::date       → today's date in that office
--   ::timestamp AT TIME ZONE tz         → that date's local midnight, as timestamptz

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

  -- Cancel yesterday's waiting/called tickets using the OFFICE-LOCAL midnight
  -- as the cutoff (see header comment for the bug being fixed).
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
