-- Add remote support columns to desktop_connections
ALTER TABLE desktop_connections ADD COLUMN IF NOT EXISTS rustdesk_id text;
ALTER TABLE desktop_connections ADD COLUMN IF NOT EXISTS rustdesk_password text;
ALTER TABLE desktop_connections ADD COLUMN IF NOT EXISTS support_started_at timestamptz;
ALTER TABLE desktop_connections ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();

CREATE INDEX IF NOT EXISTS idx_desktop_connections_support ON desktop_connections(rustdesk_id) WHERE rustdesk_id IS NOT NULL;
