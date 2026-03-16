
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ticket_id, endpoint)
);

CREATE INDEX idx_push_subs_ticket ON push_subscriptions(ticket_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anon users (customers) can insert their push subscription
CREATE POLICY "Anyone can create push subscriptions"
  ON push_subscriptions FOR INSERT WITH CHECK (true);

-- Server actions need to read subscriptions to send push
CREATE POLICY "Anyone can read push subscriptions"
  ON push_subscriptions FOR SELECT USING (true);

-- Allow upsert (re-subscribe with same endpoint)
CREATE POLICY "Anyone can update push subscriptions"
  ON push_subscriptions FOR UPDATE USING (true);
;
