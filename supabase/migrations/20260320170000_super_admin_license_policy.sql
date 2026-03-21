-- Super admin can manage ALL licenses across all organizations
CREATE POLICY "super_admin_manage_all_licenses" ON station_licenses
  FOR ALL TO authenticated
  USING (
    auth.jwt() ->> 'email' = 'f.onthenet@gmail.com'
  )
  WITH CHECK (
    auth.jwt() ->> 'email' = 'f.onthenet@gmail.com'
  );

-- Super admin can read all organizations
CREATE POLICY "super_admin_read_all_orgs" ON organizations
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'email' = 'f.onthenet@gmail.com');

-- Super admin can update all organizations (activate/deactivate)
CREATE POLICY "super_admin_manage_all_orgs" ON organizations
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' = 'f.onthenet@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'f.onthenet@gmail.com');
