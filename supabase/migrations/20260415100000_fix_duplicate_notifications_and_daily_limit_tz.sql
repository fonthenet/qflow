-- ============================================
-- Fix 1: Remove duplicate WhatsApp/Messenger notifications from DB trigger
-- The ticket-transition API is the primary notification path.
-- The trigger now only sends web push (deduplicated by browser tag)
-- and position-based reminders (next_in_line, approaching).
-- ============================================

CREATE OR REPLACE FUNCTION notify_ticket_called()
RETURNS TRIGGER AS $$
DECLARE
  desk_name TEXT;
  payload JSONB;
  edge_payload JSONB;
  has_session BOOLEAN;
  next_ticket RECORD;
  next_has_session BOOLEAN;
  was_first_in_line BOOLEAN;
  wait_minutes INT;
  approaching_ticket RECORD;
  approaching_has_session BOOLEAN;
  approaching_already_sent BOOLEAN;
  approaching_position INT;
  edge_url TEXT := 'https://ofyyzuocifigyyhqxxqw.supabase.co/functions/v1/notify-ticket';
BEGIN
  SELECT COALESCE(d.display_name, d.name, 'your desk') INTO desk_name FROM desks d WHERE d.id = NEW.desk_id;
  SELECT EXISTS(SELECT 1 FROM whatsapp_sessions WHERE ticket_id = NEW.id AND state = 'active') INTO has_session;

  -- Look up auto_no_show_timeout (stored in seconds) and convert to minutes
  SELECT COALESCE(
    CEIL((o.settings->>'auto_no_show_timeout')::numeric / 60)::int,
    10
  ) INTO wait_minutes
  FROM organizations o
  JOIN offices off ON off.organization_id = o.id
  JOIN tickets t ON t.office_id = off.id
  WHERE t.id = NEW.id
  LIMIT 1;

  -- CALLED (first time) — web push only; WhatsApp/Messenger handled by ticket-transition API
  IF NEW.status = 'called' AND (OLD.status IS NULL OR OLD.status != 'called') THEN
    payload := jsonb_build_object(
      'ticketId', NEW.id,
      'title', 'It''s Your Turn!',
      'message', 'Ticket ' || NEW.ticket_number || ' — Please go to ' || COALESCE(desk_name, 'your desk'),
      'tag', 'called-' || NEW.id,
      'url', '/q/' || NEW.qr_token
    );
    PERFORM net.http_post(
      url := 'https://qflo.net/api/push-send',
      body := payload,
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
    -- NOTE: Edge function call removed to prevent duplicate WhatsApp/Messenger messages.
    -- The ticket-transition API is the single source of truth for messaging notifications.
  END IF;

  -- RECALL — web push only
  IF NEW.status = 'called' AND OLD.status = 'called' AND NEW.called_at != OLD.called_at THEN
    payload := jsonb_build_object(
      'ticketId', NEW.id,
      'title', 'Reminder: Your Turn!',
      'message', 'Ticket ' || NEW.ticket_number || ' — Please go to ' || COALESCE(desk_name, 'your desk'),
      'tag', 'recall-' || NEW.id,
      'url', '/q/' || NEW.qr_token
    );
    PERFORM net.http_post(
      url := 'https://qflo.net/api/push-send',
      body := payload,
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END IF;

  -- SERVING / NO_SHOW / SERVED / CANCELLED:
  -- All messaging notifications handled by ticket-transition API.
  -- No trigger-based notification needed (prevents duplicates).

  -- ── POSITION-BASED REMINDERS (next_in_line + approaching) ──────────
  -- These remain in the trigger because they require complex SQL position logic
  -- that isn't easily replicated in the API route.
  IF NEW.status IN ('called', 'served', 'no_show', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN

    -- NEXT IN LINE (position 1) — only when acted ticket was first in queue
    SELECT NOT EXISTS(
      SELECT 1 FROM tickets t
      WHERE t.department_id = NEW.department_id
        AND t.office_id = NEW.office_id
        AND t.status = 'waiting'
        AND t.id != NEW.id
        AND t.created_at < NEW.created_at
        AND (t.priority >= NEW.priority)
    ) INTO was_first_in_line;

    IF was_first_in_line THEN
      SELECT t.id, t.ticket_number INTO next_ticket
      FROM tickets t
      WHERE t.department_id = NEW.department_id
        AND t.office_id = NEW.office_id
        AND t.status = 'waiting'
        AND t.id != NEW.id
      ORDER BY t.priority DESC, t.created_at ASC
      LIMIT 1;

      IF next_ticket.id IS NOT NULL THEN
        SELECT EXISTS(
          SELECT 1 FROM whatsapp_sessions WHERE ticket_id = next_ticket.id AND state = 'active'
        ) INTO next_has_session;

        IF next_has_session THEN
          edge_payload := jsonb_build_object('ticketId', next_ticket.id, 'event', 'next_in_line', 'deskName', COALESCE(desk_name, 'your desk'));
          PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
        END IF;
      END IF;
    END IF;

    -- APPROACHING (position 3) — notify ticket at position 3 if not already notified
    SELECT t.id, t.ticket_number INTO approaching_ticket
    FROM tickets t
    WHERE t.department_id = NEW.department_id
      AND t.office_id = NEW.office_id
      AND t.status = 'waiting'
      AND t.id != NEW.id
      AND t.parked_at IS NULL
    ORDER BY t.priority DESC, t.created_at ASC
    OFFSET 2 LIMIT 1;

    IF approaching_ticket.id IS NOT NULL THEN
      -- Check if we already sent an approaching notification for this ticket
      SELECT EXISTS(
        SELECT 1 FROM notifications
        WHERE ticket_id = approaching_ticket.id
          AND type LIKE '%_approaching'
      ) INTO approaching_already_sent;

      IF NOT approaching_already_sent THEN
        SELECT EXISTS(
          SELECT 1 FROM whatsapp_sessions WHERE ticket_id = approaching_ticket.id AND state = 'active'
        ) INTO approaching_has_session;

        IF approaching_has_session THEN
          approaching_position := 3;
          edge_payload := jsonb_build_object(
            'ticketId', approaching_ticket.id,
            'event', 'approaching',
            'deskName', COALESCE(desk_name, 'your desk'),
            'position', approaching_position
          );
          PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
        END IF;
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================
-- Fix 2: Daily limit trigger uses office timezone instead of UTC
-- The old code used (scheduled_at::date) which casts timestamptz to date in UTC.
-- Now we look up the org timezone and use AT TIME ZONE for correct date boundary.
-- ============================================

CREATE OR REPLACE FUNCTION check_slot_capacity()
RETURNS TRIGGER AS $$
DECLARE
  current_count integer;
  max_slots integer;
  org_id uuid;
  org_tz text;
BEGIN
  -- Get organization_id from office
  SELECT organization_id INTO org_id
  FROM offices WHERE id = NEW.office_id;

  -- Get org timezone for correct date boundary calculation
  SELECT COALESCE(timezone, 'Africa/Algiers') INTO org_tz
  FROM organizations WHERE id = org_id;

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

  -- Check daily ticket limit (using org timezone for correct date boundary)
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
        AND (scheduled_at AT TIME ZONE org_tz)::date = (NEW.scheduled_at AT TIME ZONE org_tz)::date
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
