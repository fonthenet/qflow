-- Persist the customer's stylist choice across the multi-step
-- WA / Messenger booking flow. Set on the booking_select_stylist
-- transition; stamped onto appointments.staff_id at confirm time.
-- NULL = customer picked "Any available" or the org doesn't expose
-- the stylist step.
ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS booking_staff_id uuid NULL
    REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_sessions.booking_staff_id IS
  'Salon: the stylist the customer picked during the WA/Messenger booking flow. Stamped on appointments.staff_id at confirm. NULL = "any available" or stylist step skipped.';
