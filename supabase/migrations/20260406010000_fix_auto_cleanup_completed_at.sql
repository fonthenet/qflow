-- Fix: cleanup_stale_tickets was not setting completed_at on auto-cancelled tickets
-- This replaces the function to also set completed_at = now() when auto-cancelling

CREATE OR REPLACE FUNCTION cleanup_stale_tickets() RETURNS integer AS $$
DECLARE v_count integer;
BEGIN
  WITH stale AS (
    UPDATE tickets SET
      status = 'cancelled',
      completed_at = now(),
      notes = COALESCE(notes, '') || ' [Auto-cancelled: end of day]'
    WHERE status IN ('waiting', 'called') AND created_at < CURRENT_DATE RETURNING id
  ) SELECT COUNT(*) INTO v_count FROM stale;
  UPDATE tickets SET status = 'served', completed_at = now(), notes = COALESCE(notes, '') || ' [Auto-completed: end of day]'
  WHERE status = 'serving' AND created_at < CURRENT_DATE;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
