-- BUG-1: The auto_create_whatsapp_session_for_ticket trigger used NEW.organization_id
-- which doesn't exist on the tickets table. This caused sessions to be created with
-- NULL organization_id, making them invisible to all session lookups.
-- The newer auto_create_notification_session trigger (from 20260330020000) correctly
-- JOINs the offices table to get the org_id and supersedes this trigger entirely.

DROP TRIGGER IF EXISTS trg_auto_session_for_ticket ON tickets;
DROP FUNCTION IF EXISTS auto_create_whatsapp_session_for_ticket();
