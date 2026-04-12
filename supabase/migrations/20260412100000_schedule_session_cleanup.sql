-- ============================================================
-- Scheduled cleanup for stale whatsapp_sessions and
-- notification_failures rows.
--
-- Covers:
--  • Abandoned booking flows (booking_select_*, booking_enter_*, booking_confirm)
--  • Stuck join confirmations (pending_confirmation, pending_department, pending_service, pending_language)
--  • Old completed queue sessions (state = 'completed')
--  • Stale awaiting_join sessions
--  • notification_failures older than 30 days
-- ============================================================

-- 1. Cleanup function for stale sessions
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete abandoned booking sessions older than 1 hour
  DELETE FROM whatsapp_sessions
  WHERE state IN (
    'booking_select_service',
    'booking_select_date',
    'booking_select_time',
    'booking_enter_name',
    'booking_enter_wilaya',
    'booking_enter_reason',
    'booking_enter_phone',
    'booking_confirm'
  )
  AND last_message_at < now() - interval '1 hour';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Delete stuck join confirmations older than 1 hour
  DELETE FROM whatsapp_sessions
  WHERE state IN (
    'pending_confirmation',
    'pending_department',
    'pending_service',
    'pending_language'
  )
  AND last_message_at < now() - interval '1 hour';

  GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;

  -- Delete stale awaiting_join sessions older than 24 hours
  DELETE FROM whatsapp_sessions
  WHERE state = 'awaiting_join'
  AND last_message_at < now() - interval '24 hours';

  GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;

  -- Delete completed queue sessions older than 7 days
  -- (keep a week for analytics / debugging, then purge)
  DELETE FROM whatsapp_sessions
  WHERE state = 'completed'
  AND last_message_at < now() - interval '7 days';

  GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;

  -- Cleanup old notification_failures (keep 30 days)
  DELETE FROM notification_failures
  WHERE created_at < now() - interval '30 days';

  RETURN deleted_count;
END;
$$;

-- 2. Schedule: run every hour at minute :05
-- Frequent enough to catch abandoned bookings, light enough to not matter
SELECT cron.schedule(
  'cleanup-stale-sessions',
  '5 * * * *',
  $$SELECT cleanup_stale_sessions()$$
);
