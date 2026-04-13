-- Add previous_names column to customers for name alias tracking.
-- Stores an array of past names so operators can see "Also known as" tags.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS previous_names jsonb DEFAULT '[]'::jsonb;

-- Ensure existing rows have a valid empty array (not NULL)
UPDATE customers SET previous_names = '[]'::jsonb WHERE previous_names IS NULL;
