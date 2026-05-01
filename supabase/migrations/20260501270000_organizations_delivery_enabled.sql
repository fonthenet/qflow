-- Per-org gate for the delivery feature surface (in-house riders,
-- "out for delivery" rail, assignment WA flow, rider mobile app).
--
-- Restaurant/cafe verticals get it on by default — that's the
-- existing behaviour. Other verticals stay off until an operator
-- explicitly opts in (e.g. a pharmacy adding a courier service, a
-- bakery wing of a hotel, a clinic running med-courier runs).
--
-- We chose a per-org column rather than a hardcoded vertical check
-- because the use case is bursting beyond the obvious set; treating
-- delivery as a feature-flag keeps `vertical` as identity, not as
-- a feature switch.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT false;

-- Backfill: every existing restaurant/cafe gets it on so we don't
-- silently regress any org currently using delivery. Idempotent —
-- safe to re-run on top of the default-false column.
-- Two backfill sources: the canonical `vertical` column AND the
-- legacy `business_category` key inside settings JSONB. Older orgs
-- predate the vertical migration and only have the JSONB value, so
-- we cover both to avoid losing delivery on already-using businesses.
UPDATE public.organizations
   SET delivery_enabled = true
 WHERE delivery_enabled = false
   AND (
     vertical IN ('restaurant', 'cafe')
     OR (settings ->> 'business_category') IN ('restaurant', 'cafe')
   );

CREATE INDEX IF NOT EXISTS idx_organizations_delivery_enabled
  ON public.organizations (id) WHERE delivery_enabled = true;
