-- Earlier versions of ensureAllPresets() always injected the
-- 'stylist' preset into every org's settings.intake_fields, which
-- meant a restaurant like 'fix' showed a dead "Stylist" toggle in
-- the Booking & Queue settings.
--
-- Now that ensureAllPresets() gates stylist on the salon family of
-- categories, sweep the saved data to drop the stale entries from
-- non-salon orgs so operators don't have to open Settings to
-- trigger the auto-strip.

UPDATE public.organizations o
   SET settings = jsonb_set(
         o.settings,
         '{intake_fields}',
         (
           SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
             FROM jsonb_array_elements(o.settings -> 'intake_fields') elem
            WHERE elem ->> 'key' <> 'stylist'
         )
       )
 WHERE o.settings ? 'intake_fields'
   AND jsonb_typeof(o.settings -> 'intake_fields') = 'array'
   -- Salon-family categories keep stylist; everyone else loses it.
   AND COALESCE(LOWER(o.settings ->> 'business_category'), '') NOT IN (
     'beauty', 'salon', 'barber', 'barbershop',
     'hair_salon', 'nail_salon', 'nails', 'spa'
   )
   -- Only touch rows that actually have a stylist entry.
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(o.settings -> 'intake_fields') elem
      WHERE elem ->> 'key' = 'stylist'
   );
