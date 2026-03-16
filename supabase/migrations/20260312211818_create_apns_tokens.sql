
CREATE TABLE apns_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_apns_tokens_ticket ON apns_tokens(ticket_id);

ALTER TABLE apns_tokens ENABLE ROW LEVEL SECURITY;

-- App Clip has no auth, so allow anonymous insert
CREATE POLICY "Anyone can register apns token" ON apns_tokens FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read apns tokens" ON apns_tokens FOR SELECT USING (true);
CREATE POLICY "Anyone can delete apns tokens" ON apns_tokens FOR DELETE USING (true);
;
