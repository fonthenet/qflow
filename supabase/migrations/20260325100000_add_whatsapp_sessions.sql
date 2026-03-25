-- WhatsApp queue join sessions
-- Tracks active WhatsApp conversations so inbound messages
-- can be routed to the correct org / ticket.

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_phone text NOT NULL,
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  virtual_queue_code_id uuid REFERENCES virtual_queue_codes(id) ON DELETE SET NULL,
  office_id uuid REFERENCES offices(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'awaiting_join',
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT whatsapp_session_state CHECK (state IN ('awaiting_join', 'active', 'completed'))
);

CREATE INDEX idx_whatsapp_sessions_phone ON whatsapp_sessions(whatsapp_phone, organization_id);
CREATE INDEX idx_whatsapp_sessions_ticket ON whatsapp_sessions(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX idx_whatsapp_sessions_active ON whatsapp_sessions(organization_id, state) WHERE state = 'active';

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on whatsapp_sessions"
  ON whatsapp_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
