-- Stamp the minimal intake_fields array onto every new organization.
--
-- Previously the Station's migrateToIntakeFields() synthesized a default
-- array on first settings load that turned Wilaya + Reason of visit ON.
-- For brand-new businesses that's more than they asked for — we want
-- them to start with just name + phone and opt in to anything else.
--
-- Legacy orgs (those with a `require_name_sameday` key in settings)
-- continue to go through the migration helper and keep their
-- historical wilaya + reason defaults — see intake-fields.ts.

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
      'voice_rate', 90,
      'intake_fields', jsonb_build_array(
        jsonb_build_object('key', 'name',   'type', 'preset', 'enabled', true,  'required', false),
        jsonb_build_object('key', 'phone',  'type', 'preset', 'enabled', true,  'required', false),
        jsonb_build_object('key', 'age',    'type', 'preset', 'enabled', false, 'required', false),
        jsonb_build_object('key', 'wilaya', 'type', 'preset', 'enabled', false, 'required', false),
        jsonb_build_object('key', 'reason', 'type', 'preset', 'enabled', false, 'required', false)
      )
    )
  )
  RETURNING id INTO v_org_id;

  INSERT INTO staff (auth_user_id, organization_id, full_name, email, role)
  VALUES (p_auth_user_id, v_org_id, p_admin_name, p_admin_email, 'admin');

  RETURN v_org_id;
END;
$$;
