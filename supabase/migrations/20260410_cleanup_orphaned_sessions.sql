-- Cleanup orphaned WhatsApp sessions stuck in pending_confirmation
-- Run this as a pg_cron job: SELECT cron.schedule('cleanup-orphaned-sessions', '0 3 * * *', $$DELETE FROM whatsapp_sessions WHERE status = 'pending_confirmation' AND created_at < now() - interval '24 hours'$$);

-- Manual cleanup (run once or schedule via pg_cron):
DELETE FROM whatsapp_sessions
WHERE status = 'pending_confirmation'
AND created_at < now() - interval '24 hours';
