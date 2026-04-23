-- ============================================
-- Menu + order tracking
-- ============================================
-- Lightweight "what was served" tracking. Not a POS: no payments,
-- no receipts. Prices are optional so the feature fits non-food
-- businesses (salons tracking services, clinics tracking procedures).
--
-- menu_categories   → org-scoped groupings (Entrées, Plats, Boissons…)
-- menu_items        → items inside a category, with optional price
-- ticket_items      → items attached to a specific ticket, with
--                     name/price SNAPSHOT so editing the menu later
--                     doesn't rewrite completed-ticket history.
-- ============================================

CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  icon TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_categories_org ON menu_categories(organization_id, sort_order);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10, 2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_category ON menu_items(category_id, sort_order);
CREATE INDEX idx_menu_items_org ON menu_items(organization_id);

CREATE TABLE ticket_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price NUMERIC(10, 2),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX idx_ticket_items_ticket ON ticket_items(ticket_id);
CREATE INDEX idx_ticket_items_org ON ticket_items(organization_id);

-- ============================================
-- Auto-update updated_at on menu edits
-- ============================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_menu_categories_touch
BEFORE UPDATE ON menu_categories
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_menu_items_touch
BEFORE UPDATE ON menu_items
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view org menu categories"
  ON menu_categories FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Staff can manage org menu categories"
  ON menu_categories FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

CREATE POLICY "Staff can view org menu items"
  ON menu_items FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Staff can manage org menu items"
  ON menu_items FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

CREATE POLICY "Staff can view org ticket items"
  ON ticket_items FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Staff can manage org ticket items"
  ON ticket_items FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());
