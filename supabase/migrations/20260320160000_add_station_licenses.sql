-- Station licenses — hardware-locked activation keys
CREATE TABLE IF NOT EXISTS station_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT NOT NULL UNIQUE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  organization_name TEXT,
  machine_id TEXT,          -- bound on first activation (hardware fingerprint)
  machine_name TEXT,        -- hostname for admin reference
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,   -- NULL = never expires
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_station_licenses_key ON station_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_station_licenses_org ON station_licenses(organization_id);

-- Allow anon read (for license verification from desktop app)
ALTER TABLE station_licenses ENABLE ROW LEVEL SECURITY;

-- Anon can read licenses (needed for desktop app verification)
CREATE POLICY "anon_read_licenses" ON station_licenses
  FOR SELECT TO anon USING (true);

-- Anon can update machine_id on first activation
CREATE POLICY "anon_activate_license" ON station_licenses
  FOR UPDATE TO anon USING (machine_id IS NULL)
  WITH CHECK (machine_id IS NOT NULL);

-- Authenticated users can manage licenses for their org
CREATE POLICY "org_manage_licenses" ON station_licenses
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM staff WHERE auth_user_id = auth.uid()
    )
  );
