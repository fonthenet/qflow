-- Append the new 'stylist' preset to settings.intake_fields for orgs
-- that already have a populated list, so the Settings UI surfaces
-- the toggle without forcing the operator to do anything. Defaults
-- to enabled=true, scope='booking' — same defaults the new
-- ensureAllPresets() path produces for fresh orgs.
--
-- Idempotent. Skips orgs that already have a stylist row. Skips
-- orgs whose intake_fields is empty/null entirely (those load
-- defaults at read time via ensureAllPresets, no DB row needed).

UPDATE public.organizations
SET settings = jsonb_set(
  settings,
  '{intake_fields}',
  COALESCE(settings->'intake_fields', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'key', 'stylist',
      'type', 'preset',
      'enabled', true,
      'required', false,
      'scope', 'booking'
    ))
)
WHERE jsonb_typeof(settings->'intake_fields') = 'array'
  AND jsonb_array_length(settings->'intake_fields') > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(settings->'intake_fields') AS f
    WHERE f->>'key' = 'stylist'
  );
