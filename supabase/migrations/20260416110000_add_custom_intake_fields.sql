-- Add custom_intake_data JSONB column to whatsapp_sessions
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS custom_intake_data JSONB DEFAULT NULL;

-- Update state CHECK constraint to include pending_custom_intake
ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_session_state;
ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_session_state CHECK (state = ANY (ARRAY[
  'awaiting_join'::text, 'active'::text, 'completed'::text,
  'pending_confirmation'::text, 'pending_join_name'::text,
  'pending_department'::text, 'pending_service'::text, 'pending_language'::text,
  'awaiting_intake_wilaya'::text, 'awaiting_intake_reason'::text,
  'booking_select_service'::text, 'booking_select_date'::text, 'booking_select_time'::text,
  'booking_enter_name'::text, 'booking_enter_phone'::text,
  'booking_enter_wilaya'::text, 'booking_enter_reason'::text, 'booking_confirm'::text,
  'pending_custom_intake'::text
]));
