-- Migration: byo_payment_methods
-- Introduces org_payment_methods — the BYO (Bring Your Own) payment method registry.
-- Each org configures which payment methods they accept and in what order.
-- Types: link, bank_transfer, mobile_money, qr_code, cash, custom.
-- Storage bucket payment-qrs holds QR images; access is via signed URLs (private bucket).

-- ============================================================
-- 1. TABLE: public.org_payment_methods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.org_payment_methods (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type             text        NOT NULL CHECK (type IN (
                                 'link','bank_transfer','mobile_money','qr_code','cash','custom'
                               )),
  label            text        NOT NULL,
  display_order    int         NOT NULL DEFAULT 0,
  enabled          boolean     NOT NULL DEFAULT true,
  config           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  qr_image_path    text,                            -- nullable; Supabase Storage path in payment-qrs bucket
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================
-- Composite index for active payment methods ordered by display_order (customer surface)
CREATE INDEX IF NOT EXISTS idx_org_payment_methods_org_order
  ON public.org_payment_methods (organization_id, display_order)
  WHERE enabled = true;

-- Unique: only one cash row per org (prevents duplicate cash entries)
CREATE UNIQUE INDEX IF NOT EXISTS org_payment_methods_cash_unique
  ON public.org_payment_methods (organization_id)
  WHERE type = 'cash';

-- ============================================================
-- 3. TRIGGER: auto-update updated_at (reuses existing update_updated_at function)
-- ============================================================
DROP TRIGGER IF EXISTS tr_org_payment_methods_updated_at ON public.org_payment_methods;
CREATE TRIGGER tr_org_payment_methods_updated_at
  BEFORE UPDATE ON public.org_payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.org_payment_methods ENABLE ROW LEVEL SECURITY;

-- Service role gets unrestricted access (internal operations, migrations)
DROP POLICY IF EXISTS "Service role full access on org_payment_methods" ON public.org_payment_methods;
CREATE POLICY "Service role full access on org_payment_methods"
  ON public.org_payment_methods FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Public (anon) can read enabled payment methods — safe, these are non-sensitive
-- payment instructions the business intentionally exposes to customers.
DROP POLICY IF EXISTS "Public can view enabled payment methods" ON public.org_payment_methods;
CREATE POLICY "Public can view enabled payment methods"
  ON public.org_payment_methods FOR SELECT TO anon
  USING (enabled = true);

-- All authenticated staff can read their org's payment methods (including disabled ones,
-- so the management UI can show the full list).
DROP POLICY IF EXISTS "Staff can view org payment methods" ON public.org_payment_methods;
CREATE POLICY "Staff can view org payment methods"
  ON public.org_payment_methods FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
    )
  );

-- Only owners/managers/admins can insert payment methods
DROP POLICY IF EXISTS "Managers can insert org payment methods" ON public.org_payment_methods;
CREATE POLICY "Managers can insert org payment methods"
  ON public.org_payment_methods FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

-- Only owners/managers/admins can update payment methods
DROP POLICY IF EXISTS "Managers can update org payment methods" ON public.org_payment_methods;
CREATE POLICY "Managers can update org payment methods"
  ON public.org_payment_methods FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

-- Only owners/managers/admins can delete payment methods
DROP POLICY IF EXISTS "Managers can delete org payment methods" ON public.org_payment_methods;
CREATE POLICY "Managers can delete org payment methods"
  ON public.org_payment_methods FOR DELETE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

-- ============================================================
-- 5. STORAGE BUCKET: payment-qrs (private; access via signed URLs)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-qrs', 'payment-qrs', false)
ON CONFLICT DO NOTHING;

-- Storage RLS: staff with manager+ role can insert/update/delete objects
-- under their org's prefix ({organization_id}/*). Public gets no read access.

DROP POLICY IF EXISTS "Staff managers can upload payment QRs" ON storage.objects;
CREATE POLICY "Staff managers can upload payment QRs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-qrs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

DROP POLICY IF EXISTS "Staff managers can update payment QRs" ON storage.objects;
CREATE POLICY "Staff managers can update payment QRs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'payment-qrs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

DROP POLICY IF EXISTS "Staff managers can delete payment QRs" ON storage.objects;
CREATE POLICY "Staff managers can delete payment QRs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-qrs'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.staff
      WHERE auth_user_id = (SELECT auth.uid())
        AND role IN ('owner','manager','admin')
    )
  );

-- ============================================================
-- 6. DATA MIGRATION: seed cash row for DZ orgs (idempotent)
-- Note: country_config PK column is `code`, not `country_code`.
-- The cash_unique partial index prevents duplicate cash rows.
-- ============================================================
INSERT INTO public.org_payment_methods (organization_id, type, label, display_order)
SELECT
  o.id,
  'cash',
  CASE WHEN o.country = 'DZ' THEN 'Espèces acceptées' ELSE 'Cash accepted' END,
  0
FROM public.organizations o
LEFT JOIN public.country_config cc ON cc.code = o.country
WHERE (cc.feature_flags->>'cash_only')::boolean = true
   OR o.country = 'DZ'
ON CONFLICT DO NOTHING;
