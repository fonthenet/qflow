-- Kitchen Display System (KDS): per-item lifecycle for restaurant/cafe.
--   new          → just sent to the kitchen, hasn't been started yet
--   in_progress  → cook has acknowledged + started preparing
--   ready        → plated, waiting for runner / expo to pick up
--   served       → delivered to the table (mirrors the existing 'served'
--                  ticket-level concept but at item granularity)
--
-- We rely on `added_at` as the fired-at signal — items become live to the
-- kitchen the moment the operator adds them via the OrderPad. No separate
-- "fire" step (matches our flow; can be revisited if course timing lands).
ALTER TABLE public.ticket_items
  ADD COLUMN IF NOT EXISTS kitchen_status text NOT NULL DEFAULT 'new'
    CHECK (kitchen_status IN ('new','in_progress','ready','served')),
  ADD COLUMN IF NOT EXISTS kitchen_status_at timestamptz;

-- Composite index so the KDS query (active items by org, oldest first)
-- doesn't full-scan as ticket_items grows.
CREATE INDEX IF NOT EXISTS idx_ticket_items_kitchen_active
  ON public.ticket_items (organization_id, kitchen_status, added_at)
  WHERE kitchen_status <> 'served';
