-- Add "serving" notification when ticket status changes to 'serving'
-- (i.e. when the host starts serving the customer)

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

  -- SERVING (host starts serving the customer)
  IF NEW.status = 'serving' AND OLD.status != 'serving' THEN
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'serving', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- NO SHOW
  IF NEW.status = 'no_show' AND OLD.status != 'no_show' THEN
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'no_show', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- SERVED
  IF NEW.status = 'served' AND OLD.status != 'served' THEN
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'served', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- CANCELLED
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    IF has_session THEN
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'cancelled', 'deskName', COALESCE(desk_name, 'your desk'));
      PERFORM net.http_post(url := edge_url, body := edge_payload, headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END IF;

  -- ── POSITION-BASED REMINDERS (next_in_line + approaching) ──────────
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
