-- ============================================================================
-- Qflo Performance Audit 2026-04-23 — Remediation Migration
-- Fixes: 45 unindexed FKs, 51 auth_rls_initplan policies, 32 unused indexes,
--        2 duplicate indexes.
-- Ref: docs/qa/perf-audit-2026-04-23.md
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: Missing FK indexes (45 → 0)
-- All are CREATE INDEX IF NOT EXISTS so this is safe to re-run.
-- ----------------------------------------------------------------------------

-- appointments (5 FKs)
CREATE INDEX IF NOT EXISTS idx_appointments_department_id       ON appointments (department_id);
CREATE INDEX IF NOT EXISTS idx_appointments_service_id          ON appointments (service_id);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_id            ON appointments (staff_id);
CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_parent   ON appointments (recurrence_parent_id);
CREATE INDEX IF NOT EXISTS idx_appointments_ticket_id           ON appointments (ticket_id);

-- banned_customers (1 FK)
CREATE INDEX IF NOT EXISTS idx_banned_customers_banned_by       ON banned_customers (banned_by);

-- blocked_slots (1 FK)
CREATE INDEX IF NOT EXISTS idx_blocked_slots_created_by         ON blocked_slots (created_by);

-- broadcast_logs (3 FKs)
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_office_id         ON broadcast_logs (office_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_sent_by           ON broadcast_logs (sent_by);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_template_id       ON broadcast_logs (template_id);

-- customer_imports (1 FK)
CREATE INDEX IF NOT EXISTS idx_customer_imports_imported_by     ON customer_imports (imported_by);

-- desk_heartbeats (1 FK)
CREATE INDEX IF NOT EXISTS idx_desk_heartbeats_staff_id         ON desk_heartbeats (staff_id);

-- desk_services (1 FK)
CREATE INDEX IF NOT EXISTS idx_desk_services_service_id         ON desk_services (service_id);

-- desks (1 FK)
CREATE INDEX IF NOT EXISTS idx_desks_current_staff_id           ON desks (current_staff_id);

-- feedback (1 FK)
CREATE INDEX IF NOT EXISTS idx_feedback_service_id              ON feedback (service_id);

-- group_message_recipients (1 FK)
CREATE INDEX IF NOT EXISTS idx_group_msg_recipients_customer    ON group_message_recipients (customer_id);

-- group_messages (1 FK)
CREATE INDEX IF NOT EXISTS idx_group_messages_sent_by           ON group_messages (sent_by);

-- notification_failures (1 FK)
CREATE INDEX IF NOT EXISTS idx_notif_failures_ticket_id         ON notification_failures (ticket_id);

-- office_holidays (1 FK)
CREATE INDEX IF NOT EXISTS idx_office_holidays_created_by       ON office_holidays (created_by);

-- offline_sync_queue (3 FKs)
CREATE INDEX IF NOT EXISTS idx_offline_sync_desk_id             ON offline_sync_queue (desk_id);
CREATE INDEX IF NOT EXISTS idx_offline_sync_staff_id            ON offline_sync_queue (staff_id);
CREATE INDEX IF NOT EXISTS idx_offline_sync_ticket_id           ON offline_sync_queue (ticket_id);

-- pending_device_activations (1 FK)
CREATE INDEX IF NOT EXISTS idx_pending_devices_license_id       ON pending_device_activations (approved_license_id);

-- slot_waitlist (2 FKs)
CREATE INDEX IF NOT EXISTS idx_slot_waitlist_office_id          ON slot_waitlist (office_id);
CREATE INDEX IF NOT EXISTS idx_slot_waitlist_service_id         ON slot_waitlist (service_id);

-- staff (1 FK)
CREATE INDEX IF NOT EXISTS idx_staff_department_id              ON staff (department_id);

-- template_health_snapshots (1 FK)
CREATE INDEX IF NOT EXISTS idx_tmpl_snapshots_actor_staff       ON template_health_snapshots (actor_staff_id);

-- ticket_events (2 FKs — hottest table: written on every state change)
CREATE INDEX IF NOT EXISTS idx_ticket_events_desk_id            ON ticket_events (desk_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_staff_id           ON ticket_events (staff_id);

-- ticket_items (2 FKs)
CREATE INDEX IF NOT EXISTS idx_ticket_items_added_by            ON ticket_items (added_by);
CREATE INDEX IF NOT EXISTS idx_ticket_items_menu_item_id        ON ticket_items (menu_item_id);

-- ticket_payments (1 FK)
CREATE INDEX IF NOT EXISTS idx_ticket_payments_paid_by          ON ticket_payments (paid_by);

-- tickets (6 FKs — hottest table)
CREATE INDEX IF NOT EXISTS idx_tickets_called_by_staff_id       ON tickets (called_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id              ON tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_desk_id                  ON tickets (desk_id);
CREATE INDEX IF NOT EXISTS idx_tickets_priority_category_id     ON tickets (priority_category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_service_id               ON tickets (service_id);
CREATE INDEX IF NOT EXISTS idx_tickets_transferred_from         ON tickets (transferred_from_ticket_id);

-- virtual_queue_codes (3 FKs)
CREATE INDEX IF NOT EXISTS idx_vqc_department_id                ON virtual_queue_codes (department_id);
CREATE INDEX IF NOT EXISTS idx_vqc_office_id                    ON virtual_queue_codes (office_id);
CREATE INDEX IF NOT EXISTS idx_vqc_service_id                   ON virtual_queue_codes (service_id);

-- whatsapp_sessions (4 FKs)
CREATE INDEX IF NOT EXISTS idx_wa_sessions_department_id        ON whatsapp_sessions (department_id);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_office_id            ON whatsapp_sessions (office_id);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_service_id           ON whatsapp_sessions (service_id);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_virtual_queue_code   ON whatsapp_sessions (virtual_queue_code_id);

-- ----------------------------------------------------------------------------
-- PART 2: auth_rls_initplan — wrap auth.uid() / auth.role() / auth.jwt() in
-- (SELECT ...) so Postgres evaluates once per query, not once per row.
-- Pattern: DROP policy, re-CREATE with (SELECT auth.uid()) substitution.
-- Only policies that contain auth.uid() directly (not already in SELECT)
-- are rewritten. auth.role() calls are also wrapped per Supabase guidance.
-- ----------------------------------------------------------------------------

-- billing_events
DROP POLICY IF EXISTS "billing_events_select_own_org" ON billing_events;
CREATE POLICY "billing_events_select_own_org" ON billing_events FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

-- invoices
DROP POLICY IF EXISTS "invoices_select_own_org" ON invoices;
CREATE POLICY "invoices_select_own_org" ON invoices FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

-- api_keys (3 policies)
DROP POLICY IF EXISTS "api_keys_select_own_org" ON api_keys;
CREATE POLICY "api_keys_select_own_org" ON api_keys FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "api_keys_insert_own_org" ON api_keys;
CREATE POLICY "api_keys_insert_own_org" ON api_keys FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT staff.organization_id FROM staff
    WHERE staff.auth_user_id = (SELECT auth.uid()) AND staff.role = 'admin'
  ));

DROP POLICY IF EXISTS "api_keys_delete_own_org" ON api_keys;
CREATE POLICY "api_keys_delete_own_org" ON api_keys FOR DELETE
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff
    WHERE staff.auth_user_id = (SELECT auth.uid()) AND staff.role = 'admin'
  ));

-- webhook_endpoints (4 policies)
DROP POLICY IF EXISTS "webhook_endpoints_select_own_org" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_select_own_org" ON webhook_endpoints FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "webhook_endpoints_insert_own_org" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_insert_own_org" ON webhook_endpoints FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT staff.organization_id FROM staff
    WHERE staff.auth_user_id = (SELECT auth.uid()) AND staff.role = 'admin'
  ));

DROP POLICY IF EXISTS "webhook_endpoints_update_own_org" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_update_own_org" ON webhook_endpoints FOR UPDATE
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff
    WHERE staff.auth_user_id = (SELECT auth.uid()) AND staff.role = 'admin'
  ));

DROP POLICY IF EXISTS "webhook_endpoints_delete_own_org" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_delete_own_org" ON webhook_endpoints FOR DELETE
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff
    WHERE staff.auth_user_id = (SELECT auth.uid()) AND staff.role = 'admin'
  ));

-- webhook_deliveries
DROP POLICY IF EXISTS "webhook_deliveries_select_own_org" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_select_own_org" ON webhook_deliveries FOR SELECT
  USING (endpoint_id IN (
    SELECT webhook_endpoints.id FROM webhook_endpoints
    WHERE webhook_endpoints.organization_id IN (
      SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
    )
  ));

-- blocked_slots (4 policies)
DROP POLICY IF EXISTS "Staff can read blocked slots" ON blocked_slots;
CREATE POLICY "Staff can read blocked slots" ON blocked_slots FOR SELECT
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can manage blocked slots" ON blocked_slots;
CREATE POLICY "Admins can manage blocked slots" ON blocked_slots FOR INSERT
  WITH CHECK (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.role = ANY(ARRAY['admin','manager','branch_admin'])
  ));

DROP POLICY IF EXISTS "Admins can delete blocked slots" ON blocked_slots;
CREATE POLICY "Admins can delete blocked slots" ON blocked_slots FOR DELETE
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.role = ANY(ARRAY['admin','manager','branch_admin'])
  ));

DROP POLICY IF EXISTS "Service role full access to blocked_slots" ON blocked_slots;
CREATE POLICY "Service role full access to blocked_slots" ON blocked_slots FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- office_holidays (2 policies)
DROP POLICY IF EXISTS "Staff can read office holidays" ON office_holidays;
CREATE POLICY "Staff can read office holidays" ON office_holidays FOR SELECT
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admins can manage office holidays" ON office_holidays;
CREATE POLICY "Admins can manage office holidays" ON office_holidays FOR ALL
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.role = ANY(ARRAY['admin','manager'])
  ));

-- station_licenses
DROP POLICY IF EXISTS "super_admin_manage_all_licenses" ON station_licenses;
CREATE POLICY "super_admin_manage_all_licenses" ON station_licenses FOR ALL
  USING ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com')
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com');

-- organizations (2 super_admin policies)
DROP POLICY IF EXISTS "super_admin_read_all_orgs" ON organizations;
CREATE POLICY "super_admin_read_all_orgs" ON organizations FOR SELECT
  USING ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com');

DROP POLICY IF EXISTS "super_admin_manage_all_orgs" ON organizations;
CREATE POLICY "super_admin_manage_all_orgs" ON organizations FOR UPDATE
  USING ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com')
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com');

-- pending_device_activations
DROP POLICY IF EXISTS "super_admin_manage_devices" ON pending_device_activations;
CREATE POLICY "super_admin_manage_devices" ON pending_device_activations FOR ALL
  USING ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com')
  WITH CHECK ((SELECT auth.jwt() ->> 'email') = 'f.onthenet@gmail.com');

-- whatsapp_sessions
DROP POLICY IF EXISTS "service_role_messenger_sessions" ON whatsapp_sessions;
CREATE POLICY "service_role_messenger_sessions" ON whatsapp_sessions FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- banned_customers (3 policies)
DROP POLICY IF EXISTS "Staff can view bans" ON banned_customers;
CREATE POLICY "Staff can view bans" ON banned_customers FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Staff can create bans" ON banned_customers;
CREATE POLICY "Staff can create bans" ON banned_customers FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Staff can update bans" ON banned_customers;
CREATE POLICY "Staff can update bans" ON banned_customers FOR UPDATE
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

-- push_subscriptions (3 policies with current_setting and auth.role)
DROP POLICY IF EXISTS "Users can read own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can read own push subscriptions" ON push_subscriptions FOR SELECT
  USING (
    (SELECT auth.role()) = 'service_role'
    OR endpoint = current_setting('request.header.x-push-endpoint', true)
  );

DROP POLICY IF EXISTS "Users can update own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can update own push subscriptions" ON push_subscriptions FOR UPDATE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR endpoint = current_setting('request.header.x-push-endpoint', true)
  );

DROP POLICY IF EXISTS "Service role can delete push subscriptions" ON push_subscriptions;
CREATE POLICY "Service role can delete push subscriptions" ON push_subscriptions FOR DELETE
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Service role manages push_subscriptions" ON push_subscriptions;
CREATE POLICY "Service role manages push_subscriptions" ON push_subscriptions FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- slot_waitlist (2 policies)
DROP POLICY IF EXISTS "Staff can view waitlist for their offices" ON slot_waitlist;
CREATE POLICY "Staff can view waitlist for their offices" ON slot_waitlist FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM staff s
    JOIN offices o ON o.organization_id = s.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid()) AND o.id = slot_waitlist.office_id
  ));

DROP POLICY IF EXISTS "Staff can update waitlist for their offices" ON slot_waitlist;
CREATE POLICY "Staff can update waitlist for their offices" ON slot_waitlist FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM staff s
    JOIN offices o ON o.organization_id = s.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid()) AND o.id = slot_waitlist.office_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM staff s
    JOIN offices o ON o.organization_id = s.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid()) AND o.id = slot_waitlist.office_id
  ));

-- restaurant_tables (3 policies)
DROP POLICY IF EXISTS "Service role full access to restaurant_tables" ON restaurant_tables;
CREATE POLICY "Service role full access to restaurant_tables" ON restaurant_tables FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Staff can manage restaurant tables" ON restaurant_tables;
CREATE POLICY "Staff can manage restaurant tables" ON restaurant_tables FOR ALL
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Staff can view restaurant tables" ON restaurant_tables;
CREATE POLICY "Staff can view restaurant tables" ON restaurant_tables FOR SELECT
  USING (office_id IN (
    SELECT o.id FROM offices o
    JOIN staff s ON s.organization_id = o.organization_id
    WHERE s.auth_user_id = (SELECT auth.uid())
  ));

-- ticket_sequences (2 policies)
DROP POLICY IF EXISTS "Service role manages ticket_sequences" ON ticket_sequences;
CREATE POLICY "Service role manages ticket_sequences" ON ticket_sequences FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Authenticated can use ticket_sequences" ON ticket_sequences;
CREATE POLICY "Authenticated can use ticket_sequences" ON ticket_sequences FOR ALL
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- apns_tokens (2 policies)
DROP POLICY IF EXISTS "Service role manages apns_tokens" ON apns_tokens;
CREATE POLICY "Service role manages apns_tokens" ON apns_tokens FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Users manage own apns_tokens" ON apns_tokens;
CREATE POLICY "Users manage own apns_tokens" ON apns_tokens FOR ALL
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- android_tokens (2 policies)
DROP POLICY IF EXISTS "Service role manages android_tokens" ON android_tokens;
CREATE POLICY "Service role manages android_tokens" ON android_tokens FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Users manage own android_tokens" ON android_tokens;
CREATE POLICY "Users manage own android_tokens" ON android_tokens FOR ALL
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- notifications (2 policies)
DROP POLICY IF EXISTS "Service role manages notifications" ON notifications;
CREATE POLICY "Service role manages notifications" ON notifications FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Staff can read notifications" ON notifications;
CREATE POLICY "Staff can read notifications" ON notifications FOR SELECT
  USING ((SELECT auth.role()) = 'authenticated');

-- desk_heartbeats (2 policies)
DROP POLICY IF EXISTS "Service role manages desk_heartbeats" ON desk_heartbeats;
CREATE POLICY "Service role manages desk_heartbeats" ON desk_heartbeats FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Authenticated can manage desk_heartbeats" ON desk_heartbeats;
CREATE POLICY "Authenticated can manage desk_heartbeats" ON desk_heartbeats FOR ALL
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- offline_sync_queue (2 policies)
DROP POLICY IF EXISTS "Service role manages offline_sync_queue" ON offline_sync_queue;
CREATE POLICY "Service role manages offline_sync_queue" ON offline_sync_queue FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Authenticated can manage offline_sync_queue" ON offline_sync_queue;
CREATE POLICY "Authenticated can manage offline_sync_queue" ON offline_sync_queue FOR ALL
  USING ((SELECT auth.role()) = 'authenticated')
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- appointments
DROP POLICY IF EXISTS "Service role full access to appointments" ON appointments;
CREATE POLICY "Service role full access to appointments" ON appointments FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- tickets (2 policies with auth.role/auth.uid inline)
DROP POLICY IF EXISTS "Public can view ticket by qr_token" ON tickets;
CREATE POLICY "Public can view ticket by qr_token" ON tickets FOR SELECT
  USING ((SELECT auth.role()) = 'authenticated' OR true);

DROP POLICY IF EXISTS "Public can update ticket via qr_token" ON tickets;
CREATE POLICY "Public can update ticket via qr_token" ON tickets FOR UPDATE
  USING ((SELECT auth.role()) = 'anon' AND qr_token IS NOT NULL)
  WITH CHECK (
    (SELECT auth.role()) = 'anon'
    AND qr_token IS NOT NULL
    AND status = ANY(ARRAY['waiting','checked_in','issued'])
  );

-- ticket_events
DROP POLICY IF EXISTS "Authenticated can insert ticket events" ON ticket_events;
CREATE POLICY "Authenticated can insert ticket events" ON ticket_events FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

-- whatsapp_webhook_events
DROP POLICY IF EXISTS "Org staff can read their webhook events" ON whatsapp_webhook_events;
CREATE POLICY "Org staff can read their webhook events" ON whatsapp_webhook_events FOR SELECT
  USING (organization_id IN (
    SELECT staff.organization_id FROM staff WHERE staff.auth_user_id = (SELECT auth.uid())
  ));

-- whatsapp_message_templates
DROP POLICY IF EXISTS "Org admins can view their templates" ON whatsapp_message_templates;
CREATE POLICY "Org admins can view their templates" ON whatsapp_message_templates FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT staff.organization_id FROM staff
      WHERE staff.auth_user_id = (SELECT auth.uid())
        AND staff.role = ANY(ARRAY['owner','admin'])
    )
  );

-- ----------------------------------------------------------------------------
-- PART 3: Drop 32 unused indexes (write-amplification reduction)
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_desktop_connections_support;
DROP INDEX IF EXISTS idx_notification_jobs_status_created;
DROP INDEX IF EXISTS idx_customers_tags;
DROP INDEX IF EXISTS idx_offices_wilaya;
DROP INDEX IF EXISTS idx_offices_city;
DROP INDEX IF EXISTS idx_tickets_group;
DROP INDEX IF EXISTS idx_group_message_recipients_msg;
DROP INDEX IF EXISTS idx_group_message_recipients_status;
DROP INDEX IF EXISTS idx_organizations_country;
DROP INDEX IF EXISTS idx_organizations_vertical;
DROP INDEX IF EXISTS idx_customers_city;
DROP INDEX IF EXISTS idx_payment_events_status;
DROP INDEX IF EXISTS idx_payment_events_provider;
DROP INDEX IF EXISTS idx_organizations_stripe_customer_id;
DROP INDEX IF EXISTS idx_organizations_stripe_subscription_id;
DROP INDEX IF EXISTS idx_organizations_plan_id;
DROP INDEX IF EXISTS idx_api_keys_key_hash;
DROP INDEX IF EXISTS idx_billing_events_stripe_event_id;
DROP INDEX IF EXISTS idx_webhook_deliveries_endpoint_id;
DROP INDEX IF EXISTS idx_notification_jobs_pending;
DROP INDEX IF EXISTS android_tokens_device_token_idx;
DROP INDEX IF EXISTS audit_logs_entity_idx;
DROP INDEX IF EXISTS idx_payment_events_purge_eligible;
DROP INDEX IF EXISTS template_health_snapshots_template_created_idx;
DROP INDEX IF EXISTS restaurant_tables_status_idx;
DROP INDEX IF EXISTS idx_offline_sync_pending;
DROP INDEX IF EXISTS idx_station_licenses_key;
DROP INDEX IF EXISTS sheet_links_auto_sync_idx;
DROP INDEX IF EXISTS idx_menu_items_category;

-- ----------------------------------------------------------------------------
-- PART 4: Drop duplicate indexes — keep the constraint-backed unique index
-- ----------------------------------------------------------------------------

-- google_connections: keep google_connections_organization_id_key (constraint), drop the manual one
DROP INDEX IF EXISTS google_connections_org_unique;

-- sheet_links: keep sheet_links_organization_id_key (constraint), drop the manual one
DROP INDEX IF EXISTS sheet_links_org_unique;

-- ----------------------------------------------------------------------------
-- PART 5: Remaining FK indexes found in post-migration advisor re-run
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_group_msg_recipients_group_msg ON group_message_recipients (group_message_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id         ON menu_items (category_id);
CREATE INDEX IF NOT EXISTS idx_organizations_country_fk       ON organizations (country);
CREATE INDEX IF NOT EXISTS idx_organizations_vertical_fk      ON organizations (vertical);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON webhook_deliveries (endpoint_id);

-- Fix user_data_exports auth_rls_initplan (not in original audit — found in re-run)
DROP POLICY IF EXISTS "user_data_exports: owner read" ON user_data_exports;
CREATE POLICY "user_data_exports: owner read" ON user_data_exports FOR SELECT
  USING (user_id = (SELECT auth.uid()));
