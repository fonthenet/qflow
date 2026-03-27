-- Notification retry safety net.
-- Does NOT modify the existing notify_ticket_called trigger.
-- Adds a background cron job that catches any notifications that were
-- missed (HTTP fire-and-forget failed silently) by checking for recent
-- ticket state changes without a corresponding notification record.

-- 1. Function to retry missed notifications
CREATE OR REPLACE FUNCTION retry_missed_notifications()
RETURNS void AS $$
DECLARE
  rec RECORD;
  edge_url TEXT := 'https://ofyyzuocifigyyhqxxqw.supabase.co/functions/v1/notify-ticket';
  desk_name TEXT;
  edge_payload JSONB;
BEGIN
  -- Find tickets called/recalled in last 3 minutes that have an active
  -- whatsapp/messenger session but NO notification record for the event.
  FOR rec IN
    SELECT
      t.id AS ticket_id,
      t.ticket_number,
      t.status,
      t.desk_id,
      t.called_at,
      ws.id AS session_id
    FROM tickets t
    JOIN whatsapp_sessions ws ON ws.ticket_id = t.id AND ws.state = 'active'
    WHERE t.status IN ('called', 'serving')
      AND t.called_at > NOW() - INTERVAL '3 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.ticket_id = t.id
          AND n.created_at > t.called_at - INTERVAL '5 seconds'
      )
    LIMIT 10  -- process max 10 per run to avoid long locks
  LOOP
    SELECT COALESCE(d.display_name, d.name, 'your desk')
      INTO desk_name
      FROM desks d WHERE d.id = rec.desk_id;

    edge_payload := jsonb_build_object(
      'ticketId', rec.ticket_id,
      'event', CASE WHEN rec.status = 'called' THEN 'called' ELSE 'serving' END,
      'deskName', COALESCE(desk_name, 'your desk')
    );

    BEGIN
      PERFORM net.http_post(
        url := edge_url,
        body := edge_payload,
        headers := jsonb_build_object('Content-Type', 'application/json')
      );
    EXCEPTION WHEN OTHERS THEN
      -- Log but don't crash the cron job
      RAISE WARNING '[retry_missed_notifications] Failed for ticket %: %', rec.ticket_id, SQLERRM;
    END;
  END LOOP;

  -- Also retry terminal events (no_show, served, cancelled) from last 3 min
  FOR rec IN
    SELECT
      t.id AS ticket_id,
      t.ticket_number,
      t.status,
      t.desk_id,
      t.completed_at,
      ws.id AS session_id
    FROM tickets t
    JOIN whatsapp_sessions ws ON ws.ticket_id = t.id AND ws.state = 'active'
    WHERE t.status IN ('no_show', 'served', 'cancelled')
      AND t.completed_at > NOW() - INTERVAL '3 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.ticket_id = t.id
          AND n.type LIKE '%' || t.status
          AND n.created_at > t.completed_at - INTERVAL '5 seconds'
      )
    LIMIT 10
  LOOP
    SELECT COALESCE(d.display_name, d.name, 'your desk')
      INTO desk_name
      FROM desks d WHERE d.id = rec.desk_id;

    edge_payload := jsonb_build_object(
      'ticketId', rec.ticket_id,
      'event', rec.status,
      'deskName', COALESCE(desk_name, 'your desk')
    );

    BEGIN
      PERFORM net.http_post(
        url := edge_url,
        body := edge_payload,
        headers := jsonb_build_object('Content-Type', 'application/json')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[retry_missed_notifications] Failed for ticket %: %', rec.ticket_id, SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Schedule the retry job to run every 30 seconds
SELECT cron.schedule(
  'retry-missed-notifications',
  '30 seconds',
  $$SELECT retry_missed_notifications()$$
);
