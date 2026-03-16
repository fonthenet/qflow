
-- Function that sends push notification via pg_net when ticket status changes to 'called'
CREATE OR REPLACE FUNCTION notify_ticket_called()
RETURNS TRIGGER AS $$
DECLARE
  desk_name TEXT;
  payload JSONB;
BEGIN
  -- Only fire when status changes TO 'called'
  IF NEW.status = 'called' AND (OLD.status IS NULL OR OLD.status != 'called') THEN
    -- Get desk name
    SELECT COALESCE(d.display_name, d.name, 'your desk')
    INTO desk_name
    FROM desks d
    WHERE d.id = NEW.desk_id;

    payload := jsonb_build_object(
      'ticketId', NEW.id,
      'title', 'It''s Your Turn!',
      'message', 'Ticket ' || NEW.ticket_number || ' — Please go to ' || COALESCE(desk_name, 'your desk'),
      'tag', 'called-' || NEW.id,
      'url', '/q/' || NEW.qr_token,
      'secret', 'qflow-push-79b8bdbd556d59be'
    );

    -- Fire async HTTP POST via pg_net (non-blocking, runs after transaction commits)
    PERFORM net.http_post(
      url := 'https://qflow-sigma.vercel.app/api/push-send',
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      )
    );
  END IF;

  -- Also fire for recalls (status stays 'called' but called_at changes)
  IF NEW.status = 'called' AND OLD.status = 'called' AND NEW.called_at != OLD.called_at THEN
    SELECT COALESCE(d.display_name, d.name, 'your desk')
    INTO desk_name
    FROM desks d
    WHERE d.id = NEW.desk_id;

    payload := jsonb_build_object(
      'ticketId', NEW.id,
      'title', 'Your Turn — Please Return!',
      'message', 'Ticket ' || NEW.ticket_number || ' — You are being recalled to the desk',
      'tag', 'recall-' || NEW.id,
      'url', '/q/' || NEW.qr_token,
      'secret', 'qflow-push-79b8bdbd556d59be'
    );

    PERFORM net.http_post(
      url := 'https://qflow-sigma.vercel.app/api/push-send',
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_ticket_called_push ON tickets;
CREATE TRIGGER trigger_ticket_called_push
  AFTER UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION notify_ticket_called();
;
