-- Prevent duplicate notifications when a ticket is linked to an appointment.
--
-- When lifecycle.ts handles appointment cancellation/no_show, it sends a rich
-- formatted message via WhatsApp/Messenger, then cancels linked tickets.
-- The DB trigger on tickets would then send a SECOND basic message.
--
-- Fix: before sending terminal notifications (cancelled, no_show), check if the
-- ticket is linked to an appointment that is already in a matching terminal state.
-- If so, lifecycle already sent the rich notification — skip the basic one.
--
-- Both link directions are checked:
--   1. tickets.appointment_id → appointments (Direction 1)
--   2. appointments.ticket_id → tickets  (Direction 2)

CREATE OR REPLACE FUNCTION notify_ticket_called()
RETURNS TRIGGER AS $$
DECLARE
  desk_name TEXT;
  payload JSONB;
  edge_payload JSONB;
  has_session BOOLEAN;
  has_any_session BOOLEAN;
  next_ticket RECORD;
  next_has_session BOOLEAN;
  was_first_in_line BOOLEAN;
  wait_minutes INT;
  approaching_ticket RECORD;
  approaching_has_session BOOLEAN;
  approaching_already_sent BOOLEAN;
  approaching_position INT;
  appt_status TEXT;
  skip_terminal_notify BOOLEAN := FALSE;
  edge_url TEXT := 'https://ofyyzuocifigyyhqxxqw.supabase.co/functions/v1/notify-ticket';
BEGIN
  SELECT COALESCE(d.display_name, d.name, 'your desk') INTO desk_name FROM desks d WHERE d.id = NEW.desk_id;
  SELECT EXISTS(SELECT 1 FROM whatsapp_sessions WHERE ticket_id = NEW.id AND state = 'active') INTO has_session;
  SELECT EXISTS(SELECT 1 FROM whatsapp_sessions WHERE ticket_id = NEW.id) INTO has_any_session;

  SELECT COALESCE(
    CEIL((o.settings->>'auto_no_show_timeout')::numeric / 60)::int,
    10
  ) INTO wait_minutes
  FROM organizations o
  JOIN offices off ON off.organization_id = o.id
  JOIN tickets t ON t.office_id = off.id
  WHERE t.id = NEW.id
  LIMIT 1;

  -- CALLED (first time)
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
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'called', 'deskName', COALESCE(desk_name, 'your desk'), 'waitMinutes', wait_minutes);
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- RECALL
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
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'recall', 'deskName', COALESCE(desk_name, 'your desk'), 'waitMinutes', wait_minutes);
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- SERVING
  IF NEW.status = 'serving' AND OLD.status != 'serving' THEN
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'serving', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- ── Appointment dedup check for terminal events ──────────────────
  -- If this ticket is linked to an appointment that lifecycle already
  -- transitioned to a terminal state, the rich notification was already
  -- sent. Skip the basic DB-trigger notification to avoid duplicates.
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Direction 1: ticket.appointment_id → appointment
    IF NEW.appointment_id IS NOT NULL THEN
      SELECT a.status INTO appt_status
      FROM appointments a WHERE a.id = NEW.appointment_id;
      IF appt_status IN ('cancelled', 'declined', 'no_show', 'completed') THEN
        skip_terminal_notify := TRUE;
      END IF;
    END IF;

    -- Direction 2: appointment.ticket_id → this ticket
    IF NOT skip_terminal_notify THEN
      IF EXISTS (
        SELECT 1 FROM appointments
        WHERE ticket_id = NEW.id
          AND status IN ('cancelled', 'declined', 'no_show', 'completed')
      ) THEN
        skip_terminal_notify := TRUE;
      END IF;
    END IF;
  END IF;

  -- NO SHOW (terminal — fire even if session is closed, unless appointment handled it)
  IF NEW.status = 'no_show' AND OLD.status != 'no_show' THEN
    IF has_any_session AND NOT skip_terminal_notify THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'no_show', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- SERVED (terminal — fire even if session is closed)
  IF NEW.status = 'served' AND OLD.status != 'served' THEN
    IF has_any_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'served', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- CANCELLED (terminal — fire even if session is closed, unless appointment handled it)
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    IF has_any_session AND NOT skip_terminal_notify THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'cancelled', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- POSITION REMINDERS unchanged below
  IF NEW.status IN ('called', 'served', 'no_show', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
