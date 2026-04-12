-- Add timezone column to organizations table.
-- This is the single source of truth for the business timezone.
-- All offices, appointments, and notifications use this timezone.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Africa/Algiers';

-- Backfill: copy timezone from the first office of each org (if set and not UTC)
UPDATE organizations o
SET timezone = sub.tz
FROM (
  SELECT DISTINCT ON (organization_id)
    organization_id,
    timezone AS tz
  FROM offices
  WHERE timezone IS NOT NULL
    AND timezone != 'UTC'
    AND timezone != ''
  ORDER BY organization_id, created_at ASC
) sub
WHERE o.id = sub.organization_id
  AND (o.timezone IS NULL OR o.timezone = 'UTC' OR o.timezone = 'Africa/Algiers');

-- For any org that still has no timezone set, default to Africa/Algiers
UPDATE organizations
SET timezone = 'Africa/Algiers'
WHERE timezone IS NULL OR timezone = '' OR timezone = 'UTC';
