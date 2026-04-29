-- Extend notification_jobs to carry WhatsApp messages.
--
-- Background: the table was created in 20260315071152 for push / SMS jobs
-- but never wired. We're now using it as the durable outbox for WhatsApp
-- order-lifecycle notifications (dispatched / arrived / delivered) so
-- transient Meta API failures don't lose customer messages. A Vercel
-- cron worker drains the table with exponential backoff, and the Meta
-- delivery-status webhook updates each row with sent → delivered → read
-- (or failed) so the operator can see definitively whether each
-- customer received the ping.
--
-- Existing columns are reused as-is:
--   ticket_id        — links the job to its order ticket
--   action           — the lifecycle event (order_dispatched, etc.)
--   channel          — 'whatsapp' is now a valid value
--   status           — pending, processing, sent, failed, skipped
--   payload          — kept for extra metadata (org_name, etc.)
--   attempts         — incremented on each retry
--   max_attempts     — default raised to 5 for whatsapp jobs
--   last_error       — Meta API error message on failure
--   idempotency_key  — '{ticket_id}:{action}:whatsapp' stops duplicates
--   next_retry_at    — backoff schedule cursor
--
-- Added columns:
--   to_phone         — E.164 phone we send to
--   body_text        — formatted message string, ready to ship
--   meta_message_id  — wamid returned by Meta on a successful send;
--                      used to correlate Meta's delivery-status webhook
--                      callbacks back to the job
--   meta_status      — sent / delivered / read / failed (Meta's enum)
--   meta_status_at   — when meta_status was last updated
--   updated_at       — auto-bumped by trigger on every change

ALTER TABLE notification_jobs
  ADD COLUMN IF NOT EXISTS to_phone text,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS meta_message_id text,
  ADD COLUMN IF NOT EXISTS meta_status text,
  ADD COLUMN IF NOT EXISTS meta_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Lookup index for the Meta delivery-status webhook handler.
CREATE INDEX IF NOT EXISTS idx_notification_jobs_meta_message_id
  ON notification_jobs (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- Channel index — speeds up the cron worker which only cares about
-- whatsapp jobs that are pending and ready to retry.
CREATE INDEX IF NOT EXISTS idx_notification_jobs_channel_status
  ON notification_jobs (channel, status, next_retry_at)
  WHERE status IN ('pending', 'processing');

-- Auto-bump updated_at on any UPDATE so we can spot stale rows.
CREATE OR REPLACE FUNCTION touch_notification_jobs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_jobs_updated_at ON notification_jobs;
CREATE TRIGGER trg_notification_jobs_updated_at
  BEFORE UPDATE ON notification_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_notification_jobs_updated_at();
