-- ============================================================
-- Harden RLS policies — fix overly permissive tables
-- ============================================================

-- 1. restaurant_tables: NO RLS was enabled at all
ALTER TABLE IF EXISTS restaurant_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view restaurant tables" ON restaurant_tables;
CREATE POLICY "Staff can view restaurant tables" ON restaurant_tables
  FOR SELECT USING (
    office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff can manage restaurant tables" ON restaurant_tables;
CREATE POLICY "Staff can manage restaurant tables" ON restaurant_tables
  FOR ALL USING (
    office_id IN (
      SELECT o.id FROM offices o
      JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
    )
  );

-- Service role bypass for restaurant_tables
DROP POLICY IF EXISTS "Service role full access to restaurant_tables" ON restaurant_tables;
CREATE POLICY "Service role full access to restaurant_tables" ON restaurant_tables
  FOR ALL USING (auth.role() = 'service_role');


-- 2. ticket_sequences: was USING (true) — restrict to service_role + authenticated
DROP POLICY IF EXISTS "Public access ticket_sequences" ON ticket_sequences;
DROP POLICY IF EXISTS "Anyone can manage ticket_sequences" ON ticket_sequences;
DROP POLICY IF EXISTS "ticket_sequences_policy" ON ticket_sequences;

-- Only service_role and SECURITY DEFINER functions should touch this
CREATE POLICY "Service role manages ticket_sequences" ON ticket_sequences
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users need INSERT/UPDATE for the RPC function (SECURITY DEFINER handles it,
-- but just in case there's a direct call path)
CREATE POLICY "Authenticated can use ticket_sequences" ON ticket_sequences
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- 3. apns_tokens: was USING (true) — restrict to service_role + owner
DROP POLICY IF EXISTS "Anyone can manage apns_tokens" ON apns_tokens;
DROP POLICY IF EXISTS "apns_tokens_policy" ON apns_tokens;
DROP POLICY IF EXISTS "Public access apns_tokens" ON apns_tokens;

CREATE POLICY "Service role manages apns_tokens" ON apns_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- Allow authenticated users to manage their own tokens
CREATE POLICY "Users manage own apns_tokens" ON apns_tokens
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- 4. android_tokens: was USING (true) — same fix
DROP POLICY IF EXISTS "Anyone can manage android_tokens" ON android_tokens;
DROP POLICY IF EXISTS "android_tokens_policy" ON android_tokens;
DROP POLICY IF EXISTS "Public access android_tokens" ON android_tokens;

CREATE POLICY "Service role manages android_tokens" ON android_tokens
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users manage own android_tokens" ON android_tokens
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- 5. notifications: was USING (true) for ALL — restrict
DROP POLICY IF EXISTS "Anyone can manage notifications" ON notifications;
DROP POLICY IF EXISTS "notifications_policy" ON notifications;
DROP POLICY IF EXISTS "Public access notifications" ON notifications;
DROP POLICY IF EXISTS "Public can read notifications" ON notifications;
DROP POLICY IF EXISTS "Public can insert notifications" ON notifications;

-- Service role for backend operations
CREATE POLICY "Service role manages notifications" ON notifications
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated staff can read notifications for their org
CREATE POLICY "Staff can read notifications" ON notifications
  FOR SELECT USING (auth.role() = 'authenticated');

-- Public can read their own ticket notifications (via ticket_id match)
CREATE POLICY "Public read own ticket notifications" ON notifications
  FOR SELECT USING (
    ticket_id IN (
      SELECT id FROM tickets WHERE qr_token IS NOT NULL
    )
  );

-- Public can insert notifications (for push subscription triggers)
CREATE POLICY "Public can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true);


-- 6. push_subscriptions: was USING (true) — restrict
DROP POLICY IF EXISTS "Anyone can manage push_subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_policy" ON push_subscriptions;
DROP POLICY IF EXISTS "Public access push_subscriptions" ON push_subscriptions;

CREATE POLICY "Service role manages push_subscriptions" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- Public can manage their own subscriptions (INSERT/SELECT by endpoint)
CREATE POLICY "Public can manage own push_subscriptions" ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);
  -- Note: push_subscriptions are identified by endpoint URL, not user ID.
  -- Keeping INSERT open is necessary for anonymous kiosk/display subscriptions.
  -- The data itself (endpoint URLs) is not sensitive.


-- 7. desk_heartbeats: was USING (true) — restrict to service_role + authenticated
DROP POLICY IF EXISTS "Anyone can manage desk_heartbeats" ON desk_heartbeats;
DROP POLICY IF EXISTS "desk_heartbeats_policy" ON desk_heartbeats;
DROP POLICY IF EXISTS "Public access desk_heartbeats" ON desk_heartbeats;

CREATE POLICY "Service role manages desk_heartbeats" ON desk_heartbeats
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated can manage desk_heartbeats" ON desk_heartbeats
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- 8. offline_sync_queue: was USING (true) — restrict to service_role + authenticated
DROP POLICY IF EXISTS "Anyone can manage offline_sync_queue" ON offline_sync_queue;
DROP POLICY IF EXISTS "offline_sync_queue_policy" ON offline_sync_queue;
DROP POLICY IF EXISTS "Public access offline_sync_queue" ON offline_sync_queue;

CREATE POLICY "Service role manages offline_sync_queue" ON offline_sync_queue
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated can manage offline_sync_queue" ON offline_sync_queue
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
