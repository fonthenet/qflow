-- UX & reliability improvements: add missing indices for performance.
-- Does NOT touch the notify_ticket_called trigger.

-- 1. Composite index on whatsapp_sessions for faster notification lookups
--    The trigger queries WHERE ticket_id = ? AND state = 'active' on every call/recall.
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_ticket_state
  ON whatsapp_sessions (ticket_id, state)
  WHERE state = 'active';

-- 2. Index on notification_jobs for the worker polling pattern
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_created
  ON notification_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');
