-- Per-item discount support (Toast/Square style).
-- Stored as an integer percentage 0-100. Applied at order time;
-- the final unit price snapshotted into ticket_items already
-- reflects the discount so historical totals never shift.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS discount_percent INTEGER NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
