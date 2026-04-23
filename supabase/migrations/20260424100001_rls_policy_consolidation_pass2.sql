-- Migration: RLS policy consolidation pass 2
-- Continues from 20260424100000_rls_policy_consolidation.sql
-- Addresses remaining multiple_permissive_policies findings (232 before this pass -> 208 after).

BEGIN;

-- notifications: "Service role manages notifications" ALL(service_role) is subsumed by
-- "Staff can manage notifications" ALL(true) — drop the narrower service_role ALL.
-- "Public can insert notifications" INSERT(true) is subsumed by ALL(true) — drop.
DROP POLICY IF EXISTS "Service role manages notifications" ON public.notifications;
DROP POLICY IF EXISTS "Public can insert notifications" ON public.notifications;

-- offices: "Staff can view org offices" SELECT qual == "Admin can manage offices" ALL qual
-- ALL covers SELECT — the separate SELECT is redundant.
DROP POLICY IF EXISTS "Staff can view org offices" ON public.offices;

COMMIT;
