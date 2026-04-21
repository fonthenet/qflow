-- Per-customer "auto-approve reservations" toggle.
-- When the org has require_appointment_approval=true, bookings normally land in
-- 'pending' and wait for staff to approve them. With this flag on, bookings
-- whose customer_phone matches a customer row flagged auto_approve_reservations
-- are auto-confirmed regardless. Applies to same-day and future bookings.
--
-- Matching is on (organization_id, phone) — the same key used by
-- upsertCustomerFromBooking. Column is nullable-safe via default false; if the
-- customer row doesn't exist yet for a booking, the flag simply isn't consulted
-- and the org-level approval setting wins.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS auto_approve_reservations boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.auto_approve_reservations IS
  'When true, reservations from this customer skip the approval gate and are auto-confirmed even when the org requires approval.';

-- Index to keep lookups by (organization_id, phone) with the flag cheap.
-- The existing UNIQUE(organization_id, phone) already covers the lookup key;
-- this partial index keeps hot rows tiny since most customers will be false.
CREATE INDEX IF NOT EXISTS idx_customers_auto_approve
  ON public.customers (organization_id, phone)
  WHERE auto_approve_reservations = true;
