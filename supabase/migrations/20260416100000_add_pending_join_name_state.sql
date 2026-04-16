-- Add 'pending_join_name' to whatsapp_sessions state CHECK constraint
-- Required for the require_name_sameday feature: name is collected before
-- join confirmation when the setting is enabled.
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_session_state;
ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_session_state CHECK (state = ANY (ARRAY[
  'awaiting_join'::text, 'active'::text, 'completed'::text,
  'pending_confirmation'::text, 'pending_join_name'::text,
  'pending_department'::text, 'pending_service'::text, 'pending_language'::text,
  'awaiting_intake_wilaya'::text, 'awaiting_intake_reason'::text,
  'booking_select_service'::text, 'booking_select_date'::text, 'booking_select_time'::text,
  'booking_enter_name'::text, 'booking_enter_phone'::text,
  'booking_enter_wilaya'::text, 'booking_enter_reason'::text, 'booking_confirm'::text
]));
