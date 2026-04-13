-- ============================================
-- Ticket events: deduplication + retention
-- ============================================

-- 1. Add a deterministic idempotency key so the same event
--    can be safely re-inserted from multiple Stations or retries
--    without creating duplicates.
--    Format: <ticket_id>-<event_type>-<epoch_ms>
ALTER TABLE ticket_events ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Unique constraint: if the same key arrives twice, Postgres rejects the duplicate.
-- The sync engine sends `Prefer: resolution=merge-duplicates` but that only works
-- with ON CONFLICT, so we use a partial unique index instead — INSERT will 409.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_events_idempotency
  ON ticket_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2. Add source column to track where the event originated
ALTER TABLE ticket_events ADD COLUMN IF NOT EXISTS source text DEFAULT 'server';

-- 3. Retention: auto-delete events older than 180 days.
--    Run via pg_cron or a scheduled edge function.
--    For now, create the cleanup function.
CREATE OR REPLACE FUNCTION cleanup_old_ticket_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM ticket_events
  WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 4. Index for retention cleanup performance
CREATE INDEX IF NOT EXISTS idx_ticket_events_created_at
  ON ticket_events (created_at);
