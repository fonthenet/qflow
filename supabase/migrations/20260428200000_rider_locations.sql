-- Live driver tracking: rider streams browser geolocation to the
-- customer's tracking page (qflo.net/q/<token>) while the order is in
-- transit. Each heartbeat is one row; we keep history for 24h then
-- prune (a future scheduled job — not enforced here).

CREATE TABLE IF NOT EXISTS rider_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m REAL,
  heading_deg REAL,
  speed_mps REAL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_locations_ticket_recent
  ON rider_locations(ticket_id, recorded_at DESC);

-- "Arrived at delivery location" milestone — customer gets a buzzer
-- WA at this point ("driver has arrived"). Distinct from delivered_at
-- which is the final completion stamp.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

ALTER TABLE rider_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on rider_locations"
  ON rider_locations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Public can view rider_locations"
  ON rider_locations FOR SELECT
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE rider_locations;
