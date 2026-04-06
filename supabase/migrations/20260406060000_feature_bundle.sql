-- Migration: feature_bundle
-- Adds service categories, customer notes, multi-counter, and break/pause auto-requeue

-- ============================================
-- 1. Service categories enhancement
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'icon'
  ) THEN
    ALTER TABLE services ADD COLUMN icon text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'color'
  ) THEN
    ALTER TABLE services ADD COLUMN color text DEFAULT '#6366f1';
  END IF;
END $$;

-- ============================================
-- 2. Customer notes enhancement
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'notes'
  ) THEN
    ALTER TABLE customers ADD COLUMN notes text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'tags'
  ) THEN
    ALTER TABLE customers ADD COLUMN tags text[] DEFAULT '{}';
  END IF;
END $$;

-- ============================================
-- 3. Multi-counter enhancement
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'desks' AND column_name = 'counter_number'
  ) THEN
    ALTER TABLE desks ADD COLUMN counter_number integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'desks' AND column_name = 'display_color'
  ) THEN
    ALTER TABLE desks ADD COLUMN display_color text DEFAULT '#3b82f6';
  END IF;
END $$;

-- ============================================
-- 4. Break/pause auto-requeue trigger
-- ============================================
CREATE OR REPLACE FUNCTION handle_desk_break()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t RECORD;
BEGIN
  -- Only act when status changes TO 'on_break'
  IF NEW.status = 'on_break' AND OLD.status IS DISTINCT FROM 'on_break' THEN
    -- Find all 'called' tickets assigned to this desk
    FOR t IN
      SELECT id, status
      FROM tickets
      WHERE desk_id = NEW.id
        AND status = 'called'
    LOOP
      -- Requeue the ticket back to waiting
      UPDATE tickets
      SET status          = 'waiting',
          desk_id         = NULL,
          called_at       = NULL,
          called_by_staff_id = NULL
      WHERE id = t.id;

      -- Log the event
      INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, desk_id, metadata)
      VALUES (
        t.id,
        'auto_requeue_break',
        'called',
        'waiting',
        NEW.id,
        jsonb_build_object('reason', 'desk_on_break', 'desk_name', NEW.name)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if present, then create
DROP TRIGGER IF EXISTS tr_desk_break_requeue ON desks;

CREATE TRIGGER tr_desk_break_requeue
  AFTER UPDATE OF status ON desks
  FOR EACH ROW
  EXECUTE FUNCTION handle_desk_break();
