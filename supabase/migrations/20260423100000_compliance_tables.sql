-- Migration: compliance tables for data export rate-limiting and soft-delete
-- Applied to project: ofyyzuocifigyyhqxxqw

-- ── user_data_exports ─────────────────────────────────────────────────────────
-- Tracks when a staff user last requested a full data export.
-- One row per user. Upserted on each request.
CREATE TABLE IF NOT EXISTS public.user_data_exports (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_export_at timestamptz NOT NULL DEFAULT now(),
  export_count   integer     NOT NULL DEFAULT 1
);

ALTER TABLE public.user_data_exports ENABLE ROW LEVEL SECURITY;

-- Only the owning user may read their own row; the service role writes it.
CREATE POLICY "user_data_exports: owner read"
  ON public.user_data_exports
  FOR SELECT
  USING (auth.uid() = user_id);

-- ── customers: add deleted_at for soft-delete ─────────────────────────────────
-- Guard: only add the column if it doesn't already exist (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'customers'
      AND column_name  = 'deleted_at'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN deleted_at timestamptz DEFAULT NULL;
  END IF;
END;
$$;

-- Index for efficient soft-delete queries (non-deleted rows = default read path).
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at
  ON public.customers (deleted_at)
  WHERE deleted_at IS NULL;
