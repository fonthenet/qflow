-- Allow 'pending_department' and 'pending_service' states in whatsapp_sessions.
-- Used by the interactive department/service selection flow when a business
-- has multiple departments or services.

ALTER TABLE whatsapp_sessions
  DROP CONSTRAINT whatsapp_session_state,
  ADD CONSTRAINT whatsapp_session_state
    CHECK (state IN ('awaiting_join', 'active', 'completed', 'pending_confirmation', 'pending_department', 'pending_service'));
