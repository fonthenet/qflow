-- Office (kitchen) coordinates for distance/ETA calculations on rider
-- assignments. Customer side already stores lat/lng inside
-- tickets.delivery_address (jsonb); we just need the kitchen end so the
-- haversine math has both endpoints.
--
-- Nullable on purpose: existing offices won't have geo set yet. The
-- distance line in the rider WA template degrades gracefully — when
-- either end is missing we just omit the line.

ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.offices.latitude  IS 'Office (kitchen) lat in WGS84. Used for delivery distance/ETA calc. NULL = unset; distance line is omitted from rider WA pings.';
COMMENT ON COLUMN public.offices.longitude IS 'Office (kitchen) lng in WGS84. Pairs with offices.latitude.';
