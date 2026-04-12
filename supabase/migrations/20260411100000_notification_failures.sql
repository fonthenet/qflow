-- Track notification failures for monitoring and debugging.
-- Rows are inserted by /api/ticket-transition when WhatsApp/Messenger send fails.
-- Super-admin dashboard can query this table to see recent failures.

CREATE TABLE IF NOT EXISTS notification_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  channel TEXT,
  error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for recent failures query
CREATE INDEX IF NOT EXISTS idx_notification_failures_created
  ON notification_failures(created_at DESC);

-- Auto-cleanup: keep 30 days of failure logs
-- (requires pg_cron extension — if not available, clean up manually)
-- SELECT cron.schedule('cleanup-notification-failures', '0 3 * * *',
--   $$DELETE FROM notification_failures WHERE created_at < now() - interval '30 days'$$
-- );

-- RLS: only service role can read/write
ALTER TABLE notification_failures ENABLE ROW LEVEL SECURITY;

-- No public access policies — only service role (bypasses RLS) can access
