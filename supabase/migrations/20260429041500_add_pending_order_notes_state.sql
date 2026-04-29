-- Add 'pending_order_notes' to the whatsapp_session_state CHECK constraint.
--
-- Background: when the WhatsApp ordering flow gained a notes intake step
-- (between address capture and the YES/NO confirm), every UPDATE that
-- tried to advance to state='pending_order_notes' was silently rejected
-- by Postgres CHECK constraint code 23514. The order code didn't read
-- the update result, so the bot still emitted the "Got your pin" + notes
-- prompt messages even though the state never actually moved. Customers
-- typed their note, the dispatcher routed by state (still
-- pending_order_address), and the address handler re-prompted forever.
--
-- This migration drops and recreates whatsapp_session_state with
-- pending_order_notes added to the allowed list. Idempotent: re-running
-- it just rebuilds the same constraint.

ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_session_state;

ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_session_state CHECK (
  state = ANY (ARRAY[
    'awaiting_join'::text,
    'active'::text,
    'completed'::text,
    'pending_confirmation'::text,
    'pending_join_name'::text,
    'pending_department'::text,
    'pending_service'::text,
    'pending_language'::text,
    'awaiting_intake_wilaya'::text,
    'awaiting_intake_reason'::text,
    'booking_select_service'::text,
    'booking_select_date'::text,
    'booking_select_time'::text,
    'booking_enter_name'::text,
    'booking_enter_phone'::text,
    'booking_enter_wilaya'::text,
    'booking_enter_reason'::text,
    'booking_confirm'::text,
    'pending_custom_intake'::text,
    'pending_order_browse'::text,
    'pending_order_review'::text,
    'pending_order_address'::text,
    'pending_order_notes'::text,
    'pending_order_confirm'::text
  ])
);
