-- Pending device activations — stations register themselves here
CREATE TABLE IF NOT EXISTS pending_device_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id TEXT NOT NULL,
  machine_name TEXT,
  ip_address TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_license_id UUID REFERENCES station_licenses(id),
  UNIQUE(machine_id)
);

ALTER TABLE pending_device_activations ENABLE ROW LEVEL SECURITY;

-- Anon can insert (station registers itself) and read (check if approved)
CREATE POLICY "anon_register_device" ON pending_device_activations
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_read_own_device" ON pending_device_activations
  FOR SELECT TO anon USING (true);

-- Super admin can manage all
CREATE POLICY "super_admin_manage_devices" ON pending_device_activations
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'f.onthenet@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'f.onthenet@gmail.com');
