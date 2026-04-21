-- Add a rich-text "customer file" field to the customers table.
-- Stores sanitized HTML produced by the Station's built-in rich text editor
-- (Bold / Italic / Headings / Lists / etc.). Separate from the short "notes"
-- column so operators can keep quick notes AND a longer word-like document
-- attached to each customer.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_file text;

COMMENT ON COLUMN public.customers.customer_file IS
  'Rich-text customer file (HTML). Edited via the Station Clients panel.';
