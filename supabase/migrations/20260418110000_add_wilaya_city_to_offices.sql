-- Add wilaya / city / country to offices so directory search and the mobile
-- app can filter / group results by Algerian province and commune.
ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS wilaya TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE INDEX IF NOT EXISTS idx_offices_wilaya ON public.offices(wilaya);
CREATE INDEX IF NOT EXISTS idx_offices_city ON public.offices(city);
