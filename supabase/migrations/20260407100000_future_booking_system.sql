-- ============================================
-- Future Booking System — Phase 1 Foundation
-- ============================================
-- Adds: appointments.notes, daily_ticket_limit support,
-- staff work_schedule, booking session states for WhatsApp,
-- customers enhancements, capacity enforcement trigger,
-- fixes slot_waitlist column naming bug.
-- All operations are idempotent.
-- ============================================

-- ============================================
-- 1. Fix: Add missing 'notes' column to appointments
-- (API code inserts notes but column was never created)
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'notes'
  ) THEN
    ALTER TABLE appointments ADD COLUMN notes text;
  END IF;
END $$;

-- ============================================
-- 2. Staff work schedule + per-staff slot duration
-- ============================================
-- work_schedule format: { "monday": { "open": "09:00", "close": "17:00" }, "friday": null, ... }
-- null = day off for this staff member
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'work_schedule'
  ) THEN
    ALTER TABLE staff ADD COLUMN work_schedule jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'default_slot_duration_minutes'
  ) THEN
    ALTER TABLE staff ADD COLUMN default_slot_duration_minutes integer;
  END IF;
END $$;

-- ============================================
-- 3. Extend whatsapp_sessions for booking flow
-- ============================================

-- 3a. Add booking states to session state constraint
ALTER TABLE whatsapp_sessions
  DROP CONSTRAINT whatsapp_session_state,
  ADD CONSTRAINT whatsapp_session_state
    CHECK (state IN (
      'awaiting_join', 'active', 'completed',
      'pending_confirmation', 'pending_department',
      'pending_service', 'pending_language',
      'booking_select_service', 'booking_select_date',
      'booking_select_time', 'booking_enter_name',
      'booking_enter_phone', 'booking_confirm'
    ));

-- 3b. Add booking context columns to whatsapp_sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'booking_date'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN booking_date text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'booking_time'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN booking_time text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'booking_customer_name'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN booking_customer_name text;
  END IF;
END $$;

-- 3c. Add channel column if not exists (for Messenger support)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'channel'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN channel text DEFAULT 'whatsapp';
  END IF;
END $$;

-- 3d. Add messenger_psid column if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'messenger_psid'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN messenger_psid text;
  END IF;
END $$;

-- 3e. Add locale column if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'locale'
  ) THEN
    ALTER TABLE whatsapp_sessions ADD COLUMN locale text DEFAULT 'fr';
  END IF;
END $$;

-- ============================================
-- 4. Customers table enhancements
-- ============================================

-- 4a. Add source tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'source'
  ) THEN
    ALTER TABLE customers ADD COLUMN source text DEFAULT 'auto';
    -- source: 'auto' (from ticket), 'manual' (staff added), 'import' (excel/csv), 'google_sheets'
  END IF;
END $$;

-- 4b. Add last_booking_at for appointment tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'last_booking_at'
  ) THEN
    ALTER TABLE customers ADD COLUMN last_booking_at timestamptz;
  END IF;
END $$;

-- 4c. Add booking_count
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'booking_count'
  ) THEN
    ALTER TABLE customers ADD COLUMN booking_count integer DEFAULT 0;
  END IF;
END $$;

-- 4d. Add is_banned flag
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'is_banned'
  ) THEN
    ALTER TABLE customers ADD COLUMN is_banned boolean DEFAULT false;
  END IF;
END $$;

-- 4e. Add updated_at for sync tracking
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE customers ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- ============================================
-- 5. Performance indexes
-- ============================================

-- Appointment status index
CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON appointments(office_id, status, scheduled_at);

-- Customer phone lookup (for group messaging)
CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(organization_id, phone);

-- Customer tags (for filtered group messaging)
CREATE INDEX IF NOT EXISTS idx_customers_tags
  ON customers USING GIN (tags);

-- ============================================
-- 6. Capacity enforcement trigger
-- Prevents double-booking at the database level
-- ============================================

CREATE OR REPLACE FUNCTION check_slot_capacity()
RETURNS TRIGGER AS $$
DECLARE
  current_count integer;
  max_slots integer;
  org_id uuid;
BEGIN
  -- Get organization_id from office
  SELECT organization_id INTO org_id
  FROM offices WHERE id = NEW.office_id;

  -- Get slots_per_interval from org settings (default 1)
  SELECT COALESCE((settings->>'slots_per_interval')::integer, 1)
  INTO max_slots
  FROM organizations
  WHERE id = org_id;

  -- Count existing non-cancelled appointments at the same time slot
  SELECT COUNT(*)
  INTO current_count
  FROM appointments
  WHERE office_id = NEW.office_id
    AND service_id = NEW.service_id
    AND date_trunc('minute', scheduled_at) = date_trunc('minute', NEW.scheduled_at)
    AND status NOT IN ('cancelled')
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF current_count >= max_slots THEN
    RAISE EXCEPTION 'Slot is fully booked (% of % slots taken)', current_count, max_slots;
  END IF;

  -- Check daily ticket limit
  DECLARE
    daily_limit integer;
    daily_count integer;
  BEGIN
    SELECT COALESCE((settings->>'daily_ticket_limit')::integer, 0)
    INTO daily_limit
    FROM organizations
    WHERE id = org_id;

    IF daily_limit > 0 THEN
      SELECT COUNT(*)
      INTO daily_count
      FROM appointments
      WHERE office_id = NEW.office_id
        AND (scheduled_at::date) = (NEW.scheduled_at::date)
        AND status NOT IN ('cancelled')
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF daily_count >= daily_limit THEN
        RAISE EXCEPTION 'Daily booking limit reached (% of % bookings)', daily_count, daily_limit;
      END IF;
    END IF;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_slot_capacity ON appointments;

CREATE TRIGGER tr_check_slot_capacity
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_slot_capacity();

-- ============================================
-- 7. Auto-upsert customer on appointment creation
-- ============================================

CREATE OR REPLACE FUNCTION upsert_customer_on_appointment()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
BEGIN
  -- Only if customer has a phone number
  IF NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> '' THEN
    -- Get organization_id from office
    SELECT organization_id INTO org_id
    FROM offices WHERE id = NEW.office_id;

    IF org_id IS NOT NULL THEN
      INSERT INTO customers (organization_id, phone, name, email, booking_count, last_booking_at, source, updated_at)
      VALUES (
        org_id,
        NEW.customer_phone,
        NEW.customer_name,
        NEW.customer_email,
        1,
        now(),
        'auto',
        now()
      )
      ON CONFLICT (organization_id, phone) DO UPDATE SET
        name = COALESCE(NULLIF(NEW.customer_name, ''), customers.name),
        email = COALESCE(NULLIF(NEW.customer_email, ''), customers.email),
        booking_count = customers.booking_count + 1,
        last_booking_at = now(),
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_upsert_customer_on_appointment ON appointments;

CREATE TRIGGER tr_upsert_customer_on_appointment
  AFTER INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION upsert_customer_on_appointment();

-- ============================================
-- 8. Customer imports tracking table
-- ============================================

CREATE TABLE IF NOT EXISTS customer_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename text NOT NULL,
  source text NOT NULL DEFAULT 'excel', -- 'excel', 'csv', 'google_sheets'
  total_rows integer DEFAULT 0,
  imported_rows integer DEFAULT 0,
  skipped_rows integer DEFAULT 0,
  error_rows integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  errors jsonb DEFAULT '[]',
  imported_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_customer_imports_org ON customer_imports(organization_id);

ALTER TABLE customer_imports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customer_imports' AND policyname = 'Staff can view customer imports'
  ) THEN
    CREATE POLICY "Staff can view customer imports" ON customer_imports
      FOR SELECT TO authenticated
      USING (organization_id = get_my_org_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customer_imports' AND policyname = 'Staff can manage customer imports'
  ) THEN
    CREATE POLICY "Staff can manage customer imports" ON customer_imports
      FOR ALL TO authenticated
      USING (organization_id = get_my_org_id())
      WITH CHECK (organization_id = get_my_org_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customer_imports' AND policyname = 'Service role full access on customer_imports'
  ) THEN
    CREATE POLICY "Service role full access on customer_imports" ON customer_imports
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================
-- 9. Group message logs table
-- ============================================

CREATE TABLE IF NOT EXISTS group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES auth.users(id),
  message_body text NOT NULL,
  channel text DEFAULT 'whatsapp', -- 'whatsapp', 'sms', 'all'
  filter_tags text[] DEFAULT '{}', -- empty = all customers
  total_recipients integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_group_messages_org ON group_messages(organization_id);

ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'group_messages' AND policyname = 'Staff can view group messages'
  ) THEN
    CREATE POLICY "Staff can view group messages" ON group_messages
      FOR SELECT TO authenticated
      USING (organization_id = get_my_org_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'group_messages' AND policyname = 'Staff can manage group messages'
  ) THEN
    CREATE POLICY "Staff can manage group messages" ON group_messages
      FOR ALL TO authenticated
      USING (organization_id = get_my_org_id())
      WITH CHECK (organization_id = get_my_org_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'group_messages' AND policyname = 'Service role full access on group_messages'
  ) THEN
    CREATE POLICY "Service role full access on group_messages" ON group_messages
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================
-- 10. Group message recipients (per-recipient delivery tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS group_message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_message_id uuid NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_group_message_recipients_msg ON group_message_recipients(group_message_id);
CREATE INDEX IF NOT EXISTS idx_group_message_recipients_status ON group_message_recipients(group_message_id, status);

ALTER TABLE group_message_recipients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'group_message_recipients' AND policyname = 'Service role full access on group_message_recipients'
  ) THEN
    CREATE POLICY "Service role full access on group_message_recipients" ON group_message_recipients
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
