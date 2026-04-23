-- Generic webhook deduplication table for non-Meta channels
-- (LINE, KakaoTalk, Zalo, and future channels).
--
-- UNIQUE(channel, message_id) enforces idempotency: a handler inserts on first
-- delivery; the UNIQUE constraint fires on retries and the handler returns 200
-- immediately.

CREATE TABLE IF NOT EXISTS channel_webhook_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        text        NOT NULL,                -- 'line' | 'kakao' | 'zalo' | ...
  message_id     text        NOT NULL,                -- channel-native message id (prefixed)
  organization_id uuid       REFERENCES organizations(id) ON DELETE SET NULL,
  raw_payload    jsonb        NOT NULL DEFAULT '{}',
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processed','failed','duplicate')),
  UNIQUE (channel, message_id)
);

-- Fast dedup lookup
CREATE INDEX IF NOT EXISTS idx_channel_webhook_events_dedup
  ON channel_webhook_events (channel, message_id);

-- Monitoring: org + channel + time
CREATE INDEX IF NOT EXISTS idx_channel_webhook_events_org
  ON channel_webhook_events (organization_id, channel, received_at DESC);

-- Auto-cleanup: retain 30 days
SELECT cron.schedule(
  'cleanup-channel-webhook-events',
  '0 4 * * *',
  $$DELETE FROM channel_webhook_events WHERE received_at < now() - interval '30 days'$$
);

ALTER TABLE channel_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on channel_webhook_events"
  ON channel_webhook_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Org staff can read their channel webhook events"
  ON channel_webhook_events FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM staff WHERE auth_user_id = auth.uid()
    )
  );
