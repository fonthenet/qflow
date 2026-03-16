
-- Notification outbox table for async delivery with retries
CREATE TABLE IF NOT EXISTS notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action text NOT NULL,           -- 'called', 'recall', 'buzz', 'serving', 'served', 'no_show', 'position_update'
  channel text NOT NULL,          -- 'web_push', 'apns', 'android', 'sms', 'live_activity', 'realtime_broadcast'
  status text NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'sent', 'failed', 'skipped'
  payload jsonb NOT NULL DEFAULT '{}',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  idempotency_key text,           -- dedup key: "ticket_id:action:channel:window"
  created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'))
);

-- Index for the worker: pick pending jobs ordered by creation
CREATE INDEX idx_notification_jobs_pending ON notification_jobs (next_retry_at)
  WHERE status IN ('pending', 'processing');

-- Index for idempotency lookups
CREATE UNIQUE INDEX idx_notification_jobs_idempotency ON notification_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'processing', 'sent');

-- Index for ticket cleanup
CREATE INDEX idx_notification_jobs_ticket ON notification_jobs (ticket_id);

-- Auto-cleanup: delete completed jobs older than 24 hours
-- (can be run via pg_cron or manual cleanup)

-- RLS: only service role can access
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (server actions run as authenticated) to insert
CREATE POLICY "Server can insert jobs" ON notification_jobs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow service role full access for the worker
CREATE POLICY "Service role full access" ON notification_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
;
