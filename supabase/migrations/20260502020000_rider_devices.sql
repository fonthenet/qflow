-- Per-rider device push tokens. Until now we only stored per-ticket
-- tokens (tickets.rider_push_token), which works for state changes on
-- a ticket the rider has already opened — but there's no token yet
-- when the rider gets a fresh assignment. The Station's "Assign rider"
-- click should reach the rider instantly even if their app is closed.
--
-- This table is keyed on (rider_id, device_token) so:
--   - One rider can have multiple devices (phone + tablet, work +
--     personal). Every assignment pushes to all of them.
--   - Re-registering the same token (app re-launch, phone restart)
--     upserts last_seen_at without producing a duplicate row.
--
-- Stale tokens get cleaned up by the push sender — when APNs/FCM
-- responds 410/UNREGISTERED, we drop the row.

CREATE TABLE IF NOT EXISTS public.rider_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  -- 'ios' (raw APNs token) or 'android' (FCM registration token).
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  -- Optional human-readable label like "iPhone 14 - Faycel". Helps
  -- a future "manage devices" screen.
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Bumped every time the rider re-launches the app and we re-
  -- register the token. Used to age out abandoned devices.
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_rider_device UNIQUE (rider_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_rider_devices_rider
  ON public.rider_devices (rider_id);
