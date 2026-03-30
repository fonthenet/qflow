-- Unify display screen tokens with office tokens.
-- The first (oldest) display screen per office gets its screen_token set
-- to the office's public token (first 16 hex chars of office ID without dashes),
-- matching the kiosk URL pattern: /k/{token} and /d/{token} use the same token.

WITH ranked AS (
  SELECT
    ds.id,
    ds.office_id,
    ds.screen_token,
    replace(ds.office_id::text, '-', '') AS raw_office_id,
    ROW_NUMBER() OVER (PARTITION BY ds.office_id ORDER BY ds.created_at ASC) AS rn
  FROM display_screens ds
),
first_screens AS (
  SELECT id, left(raw_office_id, 16) AS office_token
  FROM ranked
  WHERE rn = 1
    -- Only update if not already set to office token
    AND screen_token != left(raw_office_id, 16)
    -- Ensure the office token isn't already taken by another screen
    AND left(raw_office_id, 16) NOT IN (SELECT screen_token FROM display_screens)
)
UPDATE display_screens
SET screen_token = fs.office_token
FROM first_screens fs
WHERE display_screens.id = fs.id;
