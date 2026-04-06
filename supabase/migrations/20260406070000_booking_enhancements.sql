-- ============================================
-- Booking Enhancements Migration
-- All operations are idempotent (IF NOT EXISTS / DO $$ blocks)
-- ============================================

-- ============================================
-- 1. Staff/Provider Assignment on Bookings
-- ============================================

-- 1a. appointments.staff_id — optional preferred provider
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 1b. appointments.recurrence_rule — e.g., 'weekly', 'biweekly', 'monthly'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'recurrence_rule'
  ) THEN
    ALTER TABLE appointments ADD COLUMN recurrence_rule text;
  END IF;
END $$;

-- 1c. appointments.recurrence_parent_id — links recurring instances to parent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'recurrence_parent_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN recurrence_parent_id uuid REFERENCES appointments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 1d. appointments.reminder_sent — track if reminder was sent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'reminder_sent'
  ) THEN
    ALTER TABLE appointments ADD COLUMN reminder_sent boolean DEFAULT false;
  END IF;
END $$;

-- 1e. appointments.calendar_token — unique token for .ics download link
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'calendar_token'
  ) THEN
    ALTER TABLE appointments ADD COLUMN calendar_token text;
  END IF;
END $$;

-- ============================================
-- 2. Slot Waitlist
-- ============================================

CREATE TABLE IF NOT EXISTS slot_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  requested_date date NOT NULL,
  requested_time text NOT NULL,  -- HH:MM format
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  status text DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'expired')),
  created_at timestamptz DEFAULT now(),
  notified_at timestamptz
);

-- Enable RLS
ALTER TABLE slot_waitlist ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT (public waitlist joining)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slot_waitlist' AND policyname = 'Anyone can join waitlist'
  ) THEN
    CREATE POLICY "Anyone can join waitlist" ON slot_waitlist
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

-- Staff can SELECT for their org's offices
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slot_waitlist' AND policyname = 'Staff can view waitlist for their offices'
  ) THEN
    CREATE POLICY "Staff can view waitlist for their offices" ON slot_waitlist
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM staff s
          JOIN offices o ON o.organization_id = s.organization_id
          WHERE s.auth_user_id = auth.uid()
            AND o.id = slot_waitlist.office_id
        )
      );
  END IF;
END $$;

-- Staff can UPDATE for their org's offices
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slot_waitlist' AND policyname = 'Staff can update waitlist for their offices'
  ) THEN
    CREATE POLICY "Staff can update waitlist for their offices" ON slot_waitlist
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM staff s
          JOIN offices o ON o.organization_id = s.organization_id
          WHERE s.auth_user_id = auth.uid()
            AND o.id = slot_waitlist.office_id
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM staff s
          JOIN offices o ON o.organization_id = s.organization_id
          WHERE s.auth_user_id = auth.uid()
            AND o.id = slot_waitlist.office_id
        )
      );
  END IF;
END $$;

-- Service role full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slot_waitlist' AND policyname = 'Service role full access on waitlist'
  ) THEN
    CREATE POLICY "Service role full access on waitlist" ON slot_waitlist
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================
-- 3. Appointment Reminder Trigger
-- ============================================

-- Function: queue a reminder into notification_jobs 1 hour before appointment
CREATE OR REPLACE FUNCTION queue_appointment_reminder()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if the appointment has a phone number for notifications
  IF NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> '' THEN
    INSERT INTO notification_jobs (
      ticket_id,
      action,
      channel,
      status,
      payload,
      next_retry_at,
      idempotency_key
    ) VALUES (
      -- ticket_id is NULL for appointment reminders (ticket created at check-in)
      NULL,
      'appointment_reminder',
      'whatsapp',
      'pending',
      jsonb_build_object(
        'appointment_id', NEW.id,
        'customer_name', NEW.customer_name,
        'customer_phone', NEW.customer_phone,
        'customer_email', NEW.customer_email,
        'scheduled_at', NEW.scheduled_at,
        'service_id', NEW.service_id,
        'office_id', NEW.office_id,
        'staff_id', NEW.staff_id,
        'reminder_type', 'pre_appointment'
      ),
      -- Schedule reminder for 1 hour before the appointment
      NEW.scheduled_at - interval '1 hour',
      -- Idempotency key to prevent duplicate reminders
      NEW.id::text || ':appointment_reminder:whatsapp'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger to ensure idempotency
DROP TRIGGER IF EXISTS tr_appointment_reminder ON appointments;

CREATE TRIGGER tr_appointment_reminder
  AFTER INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION queue_appointment_reminder();

-- ============================================
-- 4. Auto-Complete Appointment
-- ============================================

-- Function: when a ticket is marked 'served', auto-complete linked appointment
CREATE OR REPLACE FUNCTION auto_complete_appointment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when status changes to 'served' and ticket has a linked appointment
  IF NEW.status = 'served'
     AND (OLD.status IS DISTINCT FROM 'served')
     AND NEW.appointment_id IS NOT NULL
  THEN
    UPDATE appointments
    SET status = 'completed'
    WHERE id = NEW.appointment_id
      AND status <> 'completed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger to ensure idempotency
DROP TRIGGER IF EXISTS tr_auto_complete_appointment ON tickets;

CREATE TRIGGER tr_auto_complete_appointment
  AFTER UPDATE OF status ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION auto_complete_appointment();
