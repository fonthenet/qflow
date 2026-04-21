-- Default the announcement voice to Denise (fr-FR-DeniseNeural, French
-- female) for every new organization, and backfill any existing
-- organization whose voice keys were never explicitly set.
--
-- Defaults applied:
--   voice_announcements : true
--   voice_language      : 'fr'
--   voice_gender        : 'female'
--   voice_id            : 'fr-FR-DeniseNeural'
--   voice_rate          : 90
--
-- Backfill logic uses `jsonb_set(..., create_missing := true)` only for
-- keys that don't already exist on the settings JSON — admins who
-- explicitly picked a different voice keep their choice.

CREATE OR REPLACE FUNCTION create_organization_with_admin(
  p_org_name text,
  p_org_slug text,
  p_admin_name text,
  p_admin_email text,
  p_auth_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  INSERT INTO organizations (name, slug, settings)
  VALUES (
    p_org_name,
    p_org_slug,
    jsonb_build_object(
      'voice_announcements', true,
      'voice_language', 'fr',
      'voice_gender', 'female',
      'voice_id', 'fr-FR-DeniseNeural',
      'voice_rate', 90
    )
  )
  RETURNING id INTO v_org_id;

  INSERT INTO staff (auth_user_id, organization_id, full_name, email, role)
  VALUES (p_auth_user_id, v_org_id, p_admin_name, p_admin_email, 'admin');

  RETURN v_org_id;
END;
$$;

UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('voice_announcements', true)
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'voice_announcements');

UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('voice_language', 'fr')
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'voice_language');

UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('voice_gender', 'female')
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'voice_gender');

UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('voice_id', 'fr-FR-DeniseNeural')
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'voice_id')
   OR COALESCE(settings->>'voice_id', '') = '';

UPDATE organizations
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object('voice_rate', 90)
WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'voice_rate');
