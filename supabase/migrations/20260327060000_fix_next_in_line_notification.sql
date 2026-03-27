-- Fix: only send "next in line" notification when the host calls in normal order.
-- Previously, calling any ticket (even out of order) would notify the first
-- waiting ticket that they're next, causing false alerts.

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
  edge_url TEXT := 'https://ofyyzuocifigyyhqxxqw.supabase.co/functions/v1/notify-ticket';
BEGIN
  SELECT COALESCE(d.display_name, d.name, 'your desk') INTO desk_name FROM desks d WHERE d.id = NEW.desk_id;
  SELECT EXISTS(SELECT 1 FROM whatsapp_sessions WHERE ticket_id = NEW.id AND state = 'active') INTO has_session;

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
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'called', 'deskName', COALESCE(desk_name, 'your desk'));
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
      edge_payload := jsonb_build_object('ticketId', NEW.id, 'event', 'recall', 'deskName', COALESCE(desk_name, 'your desk'));
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

  -- NEXT IN LINE — only notify when the acted ticket was first in queue
  -- (normal order). If host skipped ahead, don't send false alerts.
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
