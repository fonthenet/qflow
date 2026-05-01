-- Rider self-managed profile photo. Stored as a URL so the actual
-- bytes can live wherever we like (Supabase Storage today, S3 / CDN
-- tomorrow). Operators can also set it from the admin side, but the
-- common path is the rider uploading from their phone.

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS avatar_url text;
