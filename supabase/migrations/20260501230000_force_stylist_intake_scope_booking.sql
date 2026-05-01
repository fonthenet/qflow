-- Stylist intake field is booking-only by design — the booking flow
-- has a dedicated multi-step picker; queue-join (sameday) would
-- render a useless free-text "enter your Stylist:" prompt.
--
-- Earlier the field was seeded with scope='booking' but Settings UI
-- saves dropped it to scope='both' (or omitted), making the queue
-- intake loop fire the prompt incorrectly. Code-side fix added a
-- PRESET_SCOPE_OVERRIDES map in @qflo/shared/intake-fields.ts that
-- enforces booking-scope at filter time regardless of stored value.
-- This migration aligns the stored data so future Settings UI loads
-- show the right scope without the override having to mask it.

UPDATE public.organizations
SET settings = jsonb_set(
  settings,
  '{intake_fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'key' = 'stylist'
          THEN jsonb_set(f, '{scope}', '"booking"', true)
        ELSE f
      END
    )
    FROM jsonb_array_elements(settings->'intake_fields') AS f
  )
)
WHERE jsonb_typeof(settings->'intake_fields') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(settings->'intake_fields') AS f
    WHERE f->>'key' = 'stylist' AND COALESCE(f->>'scope', 'both') <> 'booking'
  );
