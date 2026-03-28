-- Add BSUID (Business-Scoped User ID) column for WhatsApp username adopters.
-- After March 31 2026, Meta may omit the phone number (wa_id) for users
-- who adopt a WhatsApp username. The BSUID becomes the primary identifier
-- for those users. Phone-based routing continues to work for all others.

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS whatsapp_bsuid text;

-- Index for BSUID-based session lookups (same pattern as phone index)
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_bsuid
  ON whatsapp_sessions (whatsapp_bsuid, organization_id)
  WHERE whatsapp_bsuid IS NOT NULL;
