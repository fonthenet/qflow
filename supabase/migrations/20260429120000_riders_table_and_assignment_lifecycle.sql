-- ─────────────────────────────────────────────────────────────────────
-- In-house rider directory + assignment lifecycle
--
-- Each restaurant maintains its own list of riders (delivery staff)
-- with a name + WhatsApp phone. The operator assigns an order to a
-- specific rider via the Station; the rider receives a WhatsApp
-- notification, replies ACCEPT, and the bot drives the rest of the
-- delivery lifecycle (status updates back to Station, location
-- streaming, Done).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Display name shown on Station + in WA chat. Required.
  name text NOT NULL CHECK (length(trim(name)) > 0),
  -- E.164 phone for WhatsApp. The entire model depends on matching
  -- inbound WA messages to a specific rider by `from` phone.
  phone text NOT NULL CHECK (length(trim(phone)) > 0),
  -- Soft-delete flag. Riders are inactivated rather than deleted so
  -- historical assignments stay intact + foreign keys don't break.
  is_active boolean NOT NULL DEFAULT true,
  -- Auto-bumped whenever the rider DMs the bot. The Station shows a
  -- relative-time chip ("active 2 min ago") so operators know whether
  -- the 24-hour WhatsApp window is still open before clicking Assign.
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A given phone may belong to multiple orgs (freelance courier),
  -- but only one registration per (org, phone). Use the same phone
  -- to inactivate-and-reactivate via UPDATE rather than re-INSERT.
  CONSTRAINT uq_active_org_phone UNIQUE (organization_id, phone)
);

-- Inbound-WA dispatcher needs to find a rider by phone in O(1) so
-- it can route the message before the customer-flow handlers run.
CREATE INDEX IF NOT EXISTS idx_riders_phone ON riders (phone) WHERE is_active = true;

-- Station's rider picker query.
CREATE INDEX IF NOT EXISTS idx_riders_org_active ON riders (organization_id, is_active);

-- updated_at auto-bump on every UPDATE.
CREATE OR REPLACE FUNCTION touch_riders_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_riders_updated_at ON riders;
CREATE TRIGGER trg_riders_updated_at
  BEFORE UPDATE ON riders
  FOR EACH ROW EXECUTE FUNCTION touch_riders_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;

-- Staff scoped to their own org. Same pattern used by every other
-- org-scoped table in the schema (offices, services, menu_items, etc.).
DROP POLICY IF EXISTS "Staff manage own org riders" ON riders;
CREATE POLICY "Staff manage own org riders" ON riders
  FOR ALL TO authenticated
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- Service role: full access. Required for the WA webhook handler to
-- look up a rider by inbound phone (no JWT context).
DROP POLICY IF EXISTS "Service role full access" ON riders;
CREATE POLICY "Service role full access" ON riders
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Realtime ────────────────────────────────────────────────────────
-- Station UI subscribes to riders so the picker dropdown stays fresh
-- when an admin adds a new rider in another tab. Same pattern as
-- offices / services / menu_items.
ALTER PUBLICATION supabase_realtime ADD TABLE riders;

-- ── Tickets schema additions ────────────────────────────────────────
-- assigned_rider_id already exists. Add a typed FK constraint so the
-- column is properly linked + ON DELETE SET NULL keeps history intact
-- if a rider record is hard-deleted (e.g. GDPR request).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tickets'
      AND constraint_name = 'tickets_assigned_rider_id_fkey'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_assigned_rider_id_fkey
      FOREIGN KEY (assigned_rider_id) REFERENCES riders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- New ticket_event types we'll be writing (free-form text in metadata):
--   rider_assigned                  — operator picked a rider
--   rider_accepted                  — rider sent ACCEPT
--   rider_cancelled_assignment      — rider sent CANCEL (back to operator)
--   rider_marked_done               — rider sent DONE (delivered)
