-- ============================================================
-- Harden appointments RLS — remove overly permissive public access
-- ============================================================
-- Previously: "Public can view appointments" USING (true) — exposes all PII
-- Previously: "Public can create appointments" WITH CHECK (true) — allows spam
--
-- All public access flows go through API routes that use the service_role key
-- (which bypasses RLS), so removing public policies does NOT break:
--   - /api/booking-slots (service role)
--   - /api/book-appointment (service role)
--   - /api/calendar/[token] (service role)
--   - /api/moderate-appointment (service role)
--   - /api/cron/appointment-reminders (service role)
--
-- Authenticated staff keep their existing organization-scoped policy.

-- Drop the overly permissive public policies
DROP POLICY IF EXISTS "Public can view appointments" ON appointments;
DROP POLICY IF EXISTS "Public can create appointments" ON appointments;

-- Service role bypass (used by all API routes)
DROP POLICY IF EXISTS "Service role full access to appointments" ON appointments;
CREATE POLICY "Service role full access to appointments" ON appointments
  FOR ALL USING (auth.role() = 'service_role');

-- Staff policy already exists ("Staff can manage appointments") — no change needed.
-- It uses: office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id())
