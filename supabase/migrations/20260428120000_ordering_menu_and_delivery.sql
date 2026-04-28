-- ============================================================
-- Public ordering: menu item enrichment + ticket delivery address
-- ============================================================
-- Context: /m/<officeSlug> WhatsApp/web ordering flow.
-- Customers browse the menu, place a takeout/delivery order that
-- lands as a ticket with status='pending_approval'. Operator on
-- Station accepts (→ serving) or declines (→ cancelled).
--
-- Changes:
--   1. menu_items: prep_time_minutes, is_available, image_url
--   2. tickets: delivery_address (JSONB, delivery orders only)
--   3. Partial index for the public menu read path
--   4. Anon public-read RLS policy on menu_items (is_available=TRUE only)
-- ============================================================

-- ── 1. menu_items columns ────────────────────────────────────

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- ── 2. tickets column ────────────────────────────────────────
-- Shape (informational, not enforced by DB):
--   { street, city, instructions, lat, lng, raw }
-- NULL for takeout / dine-in / non-restaurant tickets.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS delivery_address JSONB NULL;

-- ── 3. Partial index for the public menu read path ───────────
-- Powers SELECT on menu_items WHERE is_available = TRUE,
-- filtered by organization_id + category_id (the ordering page query).

CREATE INDEX IF NOT EXISTS idx_menu_items_org_available
  ON public.menu_items (organization_id, category_id)
  WHERE is_available = TRUE;

-- ── 4. Public anon read policy on menu_items ─────────────────
-- Allows the /m/<officeSlug> page to fetch available menu items
-- without an auth token. Scoped to is_available = TRUE so
-- out-of-stock items are never exposed to unauthenticated callers.
-- The existing "Staff can manage org menu items" (FOR ALL) already
-- covers authenticated org-member reads/writes; this is additive.

CREATE POLICY "Public can view available menu items"
  ON public.menu_items
  FOR SELECT
  USING (is_available = TRUE);
