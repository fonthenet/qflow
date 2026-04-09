ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS locale text;
COMMENT ON COLUMN public.appointments.locale IS 'Customer language at booking time (fr/ar/en). Used for all lifecycle notifications so the customer keeps the same language end-to-end.';
COMMENT ON COLUMN public.tickets.locale IS 'Customer language at ticket creation (fr/ar/en). Used for all lifecycle notifications.';
