
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
  -- Create organization
  INSERT INTO organizations (name, slug)
  VALUES (p_org_name, p_org_slug)
  RETURNING id INTO v_org_id;
  
  -- Create admin staff record
  INSERT INTO staff (auth_user_id, organization_id, full_name, email, role)
  VALUES (p_auth_user_id, v_org_id, p_admin_name, p_admin_email, 'admin');
  
  RETURN v_org_id;
END;
$$;
;
