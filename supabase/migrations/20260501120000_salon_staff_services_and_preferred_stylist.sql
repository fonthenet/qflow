-- Salon / barber V1 schema bits.
--
--  1. staff_services — many-to-many between staff and services.
--     Lets a salon say "Marie does Color + Cut, Karim does Cut + Beard
--     only". When NO rows exist for a stylist we treat them as able to
--     do every service (sensible default for single-chair shops).
--     Optional per-stylist price/duration overrides for premium stylists
--     who charge more for the same service.
--
--  2. customers.preferred_staff_id — remembers a customer's regular
--     stylist. Booking flow auto-suggests them; walk-in flow can show
--     "wait for Marie" vs "next available" with stylist-specific ETAs.

-- ── 1. staff_services ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  price_override_cents integer NULL,
  duration_override_minutes integer NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, service_id)
);

COMMENT ON TABLE public.staff_services IS
  'Many-to-many: which stylist can perform which service. Empty set for a stylist = "can do everything" fallback.';

CREATE INDEX IF NOT EXISTS staff_services_staff_idx
  ON public.staff_services(staff_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS staff_services_service_idx
  ON public.staff_services(service_id) WHERE is_active = true;

ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage own org staff_services" ON public.staff_services;
CREATE POLICY "Staff manage own org staff_services"
  ON public.staff_services
  USING (
    staff_id IN (SELECT id FROM public.staff WHERE organization_id = public.get_my_org_id())
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE organization_id = public.get_my_org_id())
  );

DROP POLICY IF EXISTS "Service role full access staff_services" ON public.staff_services;
CREATE POLICY "Service role full access staff_services"
  ON public.staff_services
  AS PERMISSIVE FOR ALL
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_staff_services_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_services_touch_updated_at ON public.staff_services;
CREATE TRIGGER staff_services_touch_updated_at
  BEFORE UPDATE ON public.staff_services
  FOR EACH ROW EXECUTE FUNCTION public.touch_staff_services_updated_at();

-- ── 2. customers.preferred_staff_id ────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS preferred_staff_id uuid NULL
    REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.customers.preferred_staff_id IS
  'Salon: the customer''s regular stylist. Booking + walk-in flows auto-suggest. NULL = no preference set yet.';

CREATE INDEX IF NOT EXISTS customers_preferred_staff_idx
  ON public.customers(preferred_staff_id) WHERE preferred_staff_id IS NOT NULL;
