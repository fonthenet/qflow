-- Migration: RLS policy consolidation pass 3
-- Continues from 20260424100001_rls_policy_consolidation_pass2.sql
-- multiple_permissive_policies: 208 before -> 100 after this pass.

BEGIN;

-- notifications: SELECT(true) subsumed by ALL(true) on same public role
DROP POLICY IF EXISTS "Public can view notifications" ON public.notifications;

-- menu_categories: SELECT qual == ALL qual — redundant
DROP POLICY IF EXISTS "Staff can view org menu categories" ON public.menu_categories;

-- menu_items: SELECT qual == ALL qual — redundant
DROP POLICY IF EXISTS "Staff can view org menu items" ON public.menu_items;

-- ticket_items: SELECT qual == ALL qual — redundant
DROP POLICY IF EXISTS "Staff can view org ticket items" ON public.ticket_items;

-- ticket_payments: SELECT qual == ALL qual — redundant
DROP POLICY IF EXISTS "Staff can view org payments" ON public.ticket_payments;

-- priority_categories: SELECT qual == ALL qual — redundant
DROP POLICY IF EXISTS "Staff can view priority cats" ON public.priority_categories;

-- appointments: two ALL policies (service_role OR org-scoped) — merge with OR
DROP POLICY IF EXISTS "Service role full access to appointments" ON public.appointments;
DROP POLICY IF EXISTS "Staff can manage appointments" ON public.appointments;

CREATE POLICY "Access to appointments"
  ON public.appointments
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT offices.id FROM offices
      WHERE offices.organization_id = get_my_org_id()
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT offices.id FROM offices
      WHERE offices.organization_id = get_my_org_id()
    )
  );

-- restaurant_tables: two ALL policies (service_role OR staff-join) — merge with OR
DROP POLICY IF EXISTS "Service role full access to restaurant_tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "Staff can manage restaurant tables" ON public.restaurant_tables;

CREATE POLICY "Access to restaurant_tables"
  ON public.restaurant_tables
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
    )
  );

-- blocked_slots: two ALL policies (service_role OR admin-join) — merge with OR
-- Separate SELECT "Staff can read blocked slots" remains (broader all-staff read semantics).
DROP POLICY IF EXISTS "Service role full access to blocked_slots" ON public.blocked_slots;
DROP POLICY IF EXISTS "Admins can write blocked slots" ON public.blocked_slots;

CREATE POLICY "Access to blocked_slots writes"
  ON public.blocked_slots
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
        AND s.role = ANY (ARRAY['admin','manager','branch_admin'])
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
        AND s.role = ANY (ARRAY['admin','manager','branch_admin'])
    )
  );

-- desks: UPDATE(org) is subsumed by ALL(org) — redundant UPDATE policy
DROP POLICY IF EXISTS "Staff can update desk status" ON public.desks;

COMMIT;
