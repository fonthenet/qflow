-- Tips on a service visit. Most salons in MENA accept tips; the field
-- is nullable so non-tipping verticals (clinics, banks, gov) just leave
-- it untouched.
--
-- Why tipped_staff_id separate from assigned_rider_id / assigned staff:
-- the tip recipient is usually the stylist who did the work, but at a
-- multi-chair shop the customer might tip the receptionist or split it.
-- Storing the recipient explicitly makes commission/payroll math clean.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS tip_amount_cents integer NULL,
  ADD COLUMN IF NOT EXISTS tipped_staff_id  uuid NULL
    REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tickets.tip_amount_cents IS
  'Salon: tip amount in minor currency units (DA centimes etc). NULL = no tip recorded.';
COMMENT ON COLUMN public.tickets.tipped_staff_id IS
  'Salon: who the tip goes to. Usually the stylist who served the visit; could differ. NULL when no tip.';

CREATE INDEX IF NOT EXISTS tickets_tipped_staff_idx
  ON public.tickets(tipped_staff_id) WHERE tipped_staff_id IS NOT NULL;
