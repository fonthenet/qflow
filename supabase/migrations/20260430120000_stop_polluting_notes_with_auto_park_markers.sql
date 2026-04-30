-- recover_stuck_tickets() was concatenating "[Auto-parked: 4h timeout]"
-- and "[Auto-cancelled: end of day]" onto tickets.notes, which is the
-- customer-facing notes column rendered on the operator card. Historical
-- tickets ended up with operator-confusing fake "customer notes".
--
-- Fix: log auto-park / auto-cancel as proper ticket_events rows
-- (event_type='auto_parked' / 'auto_cancelled') with metadata, and leave
-- tickets.notes alone. Also scrub existing pollution from notes so the
-- card UI is clean for older tickets too.

CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb AS $$
DECLARE
  v_parked int := 0;
  v_cancelled int := 0;
  v_desks_offlined int := 0;
BEGIN
  WITH parked AS (
    UPDATE tickets SET parked_at = now()
    WHERE status = 'serving'
      AND serving_started_at < now() - interval '4 hours'
      AND parked_at IS NULL
    RETURNING id, status
  ),
  log AS (
    INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, metadata, source)
    SELECT id, 'auto_parked', status, status,
           jsonb_build_object('reason', '4h_serving_timeout'), 'recover_stuck_tickets'
    FROM parked
    RETURNING 1
  )
  SELECT count(*) INTO v_parked FROM parked;

  WITH cancelled AS (
    UPDATE tickets t SET status = 'cancelled', completed_at = now()
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
    INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, metadata, source)
    SELECT id, 'auto_cancelled', from_status, 'cancelled',
           jsonb_build_object('reason', 'end_of_day'), 'recover_stuck_tickets'
    FROM cancelled
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

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

-- Scrub historical pollution from tickets.notes
UPDATE tickets
   SET notes = NULLIF(
         regexp_replace(notes, '\s*\[Auto-(parked|cancelled)[^\]]*\]', '', 'g'),
         ''
       )
 WHERE notes ~ '\[Auto-(parked|cancelled)';
