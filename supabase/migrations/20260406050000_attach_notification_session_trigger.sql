-- Fix: auto_create_notification_session function existed but was never attached
-- as a trigger. The old trigger trg_auto_session_for_ticket (which called
-- auto_create_whatsapp_session_for_ticket) was dropped in 20260406020000,
-- but no replacement trigger was created.
-- This caused "called" WhatsApp notifications to silently fail because
-- no session existed when the notify_ticket_called trigger checked has_session.

DROP TRIGGER IF EXISTS trg_auto_notification_session ON tickets;
CREATE TRIGGER trg_auto_notification_session
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_notification_session();
