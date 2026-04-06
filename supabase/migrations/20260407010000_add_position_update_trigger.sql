-- Trigger to send position updates when the queue shifts
-- (ticket status changes to called/served/no_show/cancelled)
-- Uses a separate function to avoid rewriting the existing notify_ticket_called trigger.

CREATE OR REPLACE FUNCTION notify_position_update()
RETURNS TRIGGER AS $$
DECLARE
  edge_url TEXT := 'https://ofyyzuocifigyyhqxxqw.supabase.co/functions/v1/position-update';
BEGIN
  -- Only fire when queue shifts (status change to terminal or called states)
  IF NEW.status IN ('called', 'served', 'no_show', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM net.http_post(
      url := edge_url,
      body := jsonb_build_object('officeId', NEW.office_id, 'departmentId', NEW.department_id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire after the existing notify_ticket_called trigger
CREATE TRIGGER trigger_position_update
  AFTER UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION notify_position_update();
