-- Webhook deduplication for WhatsApp Business Cloud API.
-- Meta delivers the same webhook payload multiple times (retries on non-2xx
-- or network hiccups). This table acts as the idempotency store: the handler
-- inserts a row on first receipt; on duplicate message_id the UNIQUE constraint
-- causes the insert to fail fast, and the handler returns 200 immediately
-- without re-processing.

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     text        UNIQUE NOT NULL, -- Meta's wamid (e.g. "wamid.xxx")
  organization_id uuid       REFERENCES organizations(id) ON DELETE SET NULL,
  phone_number_id text        NOT NULL,        -- Meta phone_number_id that received it
  raw_payload    jsonb        NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processed','failed','duplicate'))
);

-- Fast lookup by message_id (the hot path for dedup)
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_message_id
  ON whatsapp_webhook_events (message_id);

-- Dashboard / monitoring queries: org + time range
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_org
  ON whatsapp_webhook_events (organization_id, received_at DESC);

-- Cleanup: retain 30 days; older rows serve no dedup purpose
-- (pg_cron must be enabled — already present from migration 20260312160943)
SELECT cron.schedule(
  'cleanup-whatsapp-webhook-events',
  '0 4 * * *',
  $$DELETE FROM whatsapp_webhook_events WHERE received_at < now() - interval '30 days'$$
);

-- RLS: service role for all writes; org members can SELECT their own events
ALTER TABLE whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on whatsapp_webhook_events"
  ON whatsapp_webhook_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Org staff can read their own webhook events (useful for debugging)
CREATE POLICY "Org staff can read their webhook events"
  ON whatsapp_webhook_events FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM staff WHERE auth_user_id = auth.uid()
    )
  );
