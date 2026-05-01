-- Stylist break / pause status — distinct from staff.is_active.
--
--  is_active            — "can this person sign in / be assigned at all"
--                          (HR-style toggle, deactivation is rare)
--  availability_status  — "are they ON the floor right now"
--                          (operational toggle, flips many times per day)
--
-- Booking + walk-in queue + kiosk all hide stylists who aren't
-- 'available'. Auto-cleared by a soft expiry on availability_until:
-- when the timestamp is past, the resolver treats the stylist as
-- 'available' regardless of the stored status. Lets operators do
-- "back from lunch at 2pm" without remembering to flip the toggle
-- back on.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'on_break', 'off')),
  ADD COLUMN IF NOT EXISTS availability_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS availability_note text NULL;

COMMENT ON COLUMN public.staff.availability_status IS
  'Operational on-floor status. ''available'' = ready to be assigned; ''on_break'' = lunch / pause (auto-clears at availability_until); ''off'' = end of shift (manual clear).';
COMMENT ON COLUMN public.staff.availability_until IS
  'Soft expiry hint. When this is in the past, the resolver treats the stylist as ''available'' regardless of availability_status. NULL = no auto-clear.';

CREATE INDEX IF NOT EXISTS staff_availability_idx
  ON public.staff(office_id, availability_status) WHERE is_active = true;
