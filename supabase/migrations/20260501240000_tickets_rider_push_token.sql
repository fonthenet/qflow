-- Rider device push token, captured when the native rider app opens
-- the deep-linked screen. Lets the assignment/cancel/unassign notifier
-- push the rider instantly even when the app is closed and the phone
-- is locked — no longer dependent on the rider noticing a WhatsApp
-- message. Same token is HMAC-verified before any push fires.
--
-- Scoped per-ticket (not per-rider) because the rider auth model is
-- still token-based, not staff-login. When a delivery completes the
-- token gets cleared by the same /api/rider/heartbeat `{stopped:true}`
-- path that stops the location task.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS rider_push_token text,
  ADD COLUMN IF NOT EXISTS rider_push_platform text;

CREATE INDEX IF NOT EXISTS idx_tickets_rider_push_token
  ON public.tickets (id)
  WHERE rider_push_token IS NOT NULL;
