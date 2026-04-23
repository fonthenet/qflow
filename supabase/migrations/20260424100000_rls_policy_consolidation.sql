-- Migration: RLS policy consolidation
-- Addresses: multiple_permissive_policies advisor (388 findings before this migration)
-- Postgres OR-s all permissive policies for the same (table, role, action) pair,
-- so duplicate/redundant policies cost planner work on every query.
-- Strategy: drop redundant SELECT policies that are fully subsumed by an ALL policy
-- with the same or broader qual; collapse open-access token-table policies.

BEGIN;

-- =========================================================
-- 1. broadcast_logs
--    "Staff can view broadcast logs" SELECT qual == "Staff can manage broadcast logs" ALL qual
--    ALL covers SELECT, so the separate SELECT is redundant.
-- =========================================================
DROP POLICY IF EXISTS "Staff can view broadcast logs" ON public.broadcast_logs;

-- =========================================================
-- 2. broadcast_templates
--    Same pattern as broadcast_logs.
-- =========================================================
DROP POLICY IF EXISTS "Staff can view broadcast templates" ON public.broadcast_templates;

-- =========================================================
-- 3. customers
--    "Staff can view customers" SELECT qual == "Staff can manage customers" ALL qual
-- =========================================================
DROP POLICY IF EXISTS "Staff can view customers" ON public.customers;

-- =========================================================
-- 4. departments
--    "Staff can view departments" SELECT qual == "Admin can manage departments" ALL qual
-- =========================================================
DROP POLICY IF EXISTS "Staff can view departments" ON public.departments;

-- =========================================================
-- 5. desk_services
--    "Staff can view desk_services" SELECT qual == "Admin can manage desk_services" ALL qual
-- =========================================================
DROP POLICY IF EXISTS "Staff can view desk_services" ON public.desk_services;

-- =========================================================
-- 6. intake_form_fields
--    "Anyone can view intake fields" SELECT = USING(true) — broader than the ALL org-scoped policy.
--    This is intentional (public read), so keep it. But "Admin can manage intake fields" ALL
--    already covers SELECT for admins. The advisor fires because both apply to public role.
--    The public SELECT (true) is the intentional broader one; drop nothing here — different semantics.
--    SKIP — deferred (see report).
-- =========================================================

-- =========================================================
-- 7. services
--    "Staff can view services" SELECT qual == "Admin can manage services" ALL qual
-- =========================================================
DROP POLICY IF EXISTS "Staff can view services" ON public.services;

-- =========================================================
-- 8. staff
--    "Staff can view org staff" SELECT qual == "Admin can manage staff" ALL qual
-- =========================================================
DROP POLICY IF EXISTS "Staff can view org staff" ON public.staff;

-- =========================================================
-- 9. desks
--    "Staff can view desks" SELECT qual == "Admin can manage desks" ALL qual (same org check).
--    "Anyone can read desk names" SELECT = USING(true) is the public-read policy — intentionally
--    broader. Dropping the middle SELECT ("Staff can view desks") removes the redundancy between
--    ALL and that scoped SELECT, while keeping the public USING(true) SELECT.
-- =========================================================
DROP POLICY IF EXISTS "Staff can view desks" ON public.desks;

-- =========================================================
-- 10. notifications
--     "Public can view notifications" SELECT = USING(true) subsumes
--     "Public read own ticket notifications" (narrower) and
--     "Staff can read notifications" (authenticated check).
--     Drop the two narrower ones — USING(true) already grants them.
-- =========================================================
DROP POLICY IF EXISTS "Public read own ticket notifications" ON public.notifications;
DROP POLICY IF EXISTS "Staff can read notifications" ON public.notifications;

-- =========================================================
-- 11. desk_heartbeats
--     Three ALL policies on public role:
--       a) "Service role full access on desk_heartbeats" — USING(true) — broadest
--       b) "Service role manages desk_heartbeats" — role='service_role'
--       c) "Authenticated can manage desk_heartbeats" — role='authenticated'
--     (a) subsumes both (b) and (c). Drop (b) and (c).
-- =========================================================
DROP POLICY IF EXISTS "Service role manages desk_heartbeats" ON public.desk_heartbeats;
DROP POLICY IF EXISTS "Authenticated can manage desk_heartbeats" ON public.desk_heartbeats;

-- =========================================================
-- 12. offline_sync_queue
--     Same pattern as desk_heartbeats:
--       a) "Service role full access on offline_sync_queue" — USING(true)
--       b) "Service role manages offline_sync_queue" — role='service_role'
--       c) "Authenticated can manage offline_sync_queue" — role='authenticated'
--     (a) subsumes (b) and (c).
-- =========================================================
DROP POLICY IF EXISTS "Service role manages offline_sync_queue" ON public.offline_sync_queue;
DROP POLICY IF EXISTS "Authenticated can manage offline_sync_queue" ON public.offline_sync_queue;

-- =========================================================
-- 13. android_tokens
--     Has per-cmd open policies (SELECT/INSERT/UPDATE/DELETE all = true) PLUS two ALL policies
--     (service_role, authenticated). The open per-cmd policies subsume the ALL role policies.
--     Drop the two ALL policies; keep the open per-cmd ones.
-- =========================================================
DROP POLICY IF EXISTS "Service role manages android_tokens" ON public.android_tokens;
DROP POLICY IF EXISTS "Users manage own android_tokens" ON public.android_tokens;

-- =========================================================
-- 14. apns_tokens
--     Same pattern: open SELECT/INSERT/DELETE per-cmd policies already exist.
--     The "Users manage own apns_tokens" ALL (authenticated) and
--     "Service role manages apns_tokens" ALL (service_role) are redundant.
--     Note: apns_tokens has no open UPDATE policy — the ALL policies cover UPDATE for those roles.
--     We must keep UPDATE access. Drop the ALL policies and add a single open UPDATE policy
--     to maintain parity (the open SELECT/INSERT/DELETE already exist).
-- =========================================================
DROP POLICY IF EXISTS "Service role manages apns_tokens" ON public.apns_tokens;
DROP POLICY IF EXISTS "Users manage own apns_tokens" ON public.apns_tokens;

-- Restore UPDATE access that was provided by the dropped ALL policies
CREATE POLICY "Anyone can update apns tokens"
  ON public.apns_tokens
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- =========================================================
-- 15. restaurant_tables
--     "Staff can view restaurant tables" SELECT qual == "Staff can manage restaurant tables" ALL qual
--     (both join offices+staff on auth_user_id). Drop the redundant SELECT.
-- =========================================================
DROP POLICY IF EXISTS "Staff can view restaurant tables" ON public.restaurant_tables;

-- =========================================================
-- 16. ticket_sequences
--     "Authenticated can use ticket_sequences" ALL (authenticated) and
--     "Service role manages ticket_sequences" ALL (service_role) — both on public role.
--     These are two distinct ALL policies with different quals — they are the primary access,
--     not duplicates of each other. Advisor fires because both are permissive ALL on public.
--     Consolidate into one policy using OR.
-- =========================================================
DROP POLICY IF EXISTS "Service role manages ticket_sequences" ON public.ticket_sequences;
DROP POLICY IF EXISTS "Authenticated can use ticket_sequences" ON public.ticket_sequences;

CREATE POLICY "Role based access to ticket_sequences"
  ON public.ticket_sequences
  FOR ALL
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.role()) = 'authenticated'
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.role()) = 'authenticated'
  );

-- =========================================================
-- 17. tickets
--     "Public can view ticket by qr_token" SELECT = USING((auth.role()='authenticated' OR true))
--     which simplifies to USING(true) — subsumes "Staff can view org tickets" SELECT.
--     Drop "Staff can view org tickets" SELECT — the true-select already covers staff.
--     NOTE: the ALL policy "Staff can manage tickets" still gates writes correctly.
-- =========================================================
DROP POLICY IF EXISTS "Staff can view org tickets" ON public.tickets;

-- =========================================================
-- 18. blocked_slots
--     Has:
--       a) "Service role full access to blocked_slots" ALL (service_role qual)
--       b) "Admins can delete blocked slots" DELETE (admin join)
--       c) "Admins can manage blocked slots" INSERT (admin join)
--       d) "Staff can read blocked slots" SELECT (staff join)
--     (b) and (c) are separate DELETE/INSERT with identical qual — consolidate into one ALL
--     for INSERT+DELETE. (d) SELECT is different (broader — all staff, not just admin roles).
--     Consolidate (b)+(c) into an ALL-writes policy.
-- =========================================================
DROP POLICY IF EXISTS "Admins can delete blocked slots" ON public.blocked_slots;
DROP POLICY IF EXISTS "Admins can manage blocked slots" ON public.blocked_slots;

CREATE POLICY "Admins can write blocked slots"
  ON public.blocked_slots
  FOR ALL
  USING (
    office_id IN (
      SELECT o.id
      FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
        AND s.role = ANY (ARRAY['admin','manager','branch_admin'])
    )
  )
  WITH CHECK (
    office_id IN (
      SELECT o.id
      FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = (SELECT auth.uid())
        AND s.role = ANY (ARRAY['admin','manager','branch_admin'])
    )
  );

COMMIT;
