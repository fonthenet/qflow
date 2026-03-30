-- Allow 'pending_confirmation' state in whatsapp_sessions.
-- Used by the join confirmation flow: user sends JOIN <code>,
-- a pending row is created, then promoted to 'active' on YES.

ALTER TABLE whatsapp_sessions
  DROP CONSTRAINT whatsapp_session_state,
  ADD CONSTRAINT whatsapp_session_state
    CHECK (state IN ('awaiting_join', 'active', 'completed', 'pending_confirmation'));
