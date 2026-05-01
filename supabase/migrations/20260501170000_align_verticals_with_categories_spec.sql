-- Verticals table was missing slugs that the @qflo/shared categories
-- spec referenced. Combined with a silent FK violation on
-- organizations.vertical (no error check on the settings update),
-- this silently broke onboarding for several categories — the auth
-- user, RPC, and seeding all succeeded, but business_category +
-- channelDefaults never landed because the orgUpdate failed.
--
-- Adding the missing slugs is the database half of the fix; the
-- @qflo/shared categories.ts vertical values are realigned to match
-- the canonical DB slugs in the same commit, and the route now logs
-- the error instead of swallowing it.

INSERT INTO public.verticals (slug, category, name_en, name_fr, name_ar)
VALUES
  ('insurance',   'finance',  'Insurance',   'Assurance',  'تأمين'),
  ('legal',       'services', 'Legal',       'Juridique',  'قانوني'),
  ('real_estate', 'services', 'Real Estate', 'Immobilier', 'عقارات'),
  ('general',     'services', 'General',     'Général',    'عام')
ON CONFLICT (slug) DO NOTHING;
