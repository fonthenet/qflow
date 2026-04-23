-- Per-tenant WhatsApp Business API credentials.
--
-- Each org brings its own WABA. Tokens are encrypted at rest using AES-256-GCM
-- via the app-level encrypt/decrypt helpers (key from ENCRYPTION_SECRET env var).
-- The nonce is stored inline as part of the encrypted value in the format:
--   base64(nonce) + '.' + base64(ciphertext)
--
-- whatsapp_verify_token is used to route Meta's GET challenge to the correct
-- tenant when using per-org webhook URLs. It is not itself sensitive (public in
-- the Meta dashboard URL) but is stored here for convenience.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id       text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token_encrypted text,  -- AES-256-GCM encrypted
  ADD COLUMN IF NOT EXISTS whatsapp_business_account_id   text,
  ADD COLUMN IF NOT EXISTS whatsapp_verify_token          text;

-- Index for fast per-tenant webhook routing by verify_token
CREATE INDEX IF NOT EXISTS idx_orgs_whatsapp_verify_token
  ON organizations (whatsapp_verify_token)
  WHERE whatsapp_verify_token IS NOT NULL;

-- Index for routing by phone_number_id (Meta metadata field in webhooks)
CREATE INDEX IF NOT EXISTS idx_orgs_whatsapp_phone_number_id
  ON organizations (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

-- RLS note: these columns sit on the organizations table which already has RLS.
-- Staff can read their own org row; only service_role can write these columns
-- (the admin settings UI calls a SECURITY DEFINER function).

-- Function: upsert WhatsApp credentials (called by admin settings API route).
-- Runs as SECURITY DEFINER so the encrypted token is never exposed in transit.
CREATE OR REPLACE FUNCTION upsert_org_whatsapp_credentials(
  p_org_id                       uuid,
  p_phone_number_id              text,
  p_access_token_encrypted       text,
  p_business_account_id          text,
  p_verify_token                 text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be authenticated staff of this org
  IF NOT EXISTS (
    SELECT 1 FROM staff
    WHERE organization_id = p_org_id
      AND auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only org admins can update WhatsApp credentials';
  END IF;

  UPDATE organizations
  SET
    whatsapp_phone_number_id       = p_phone_number_id,
    whatsapp_access_token_encrypted = p_access_token_encrypted,
    whatsapp_business_account_id   = p_business_account_id,
    whatsapp_verify_token          = p_verify_token,
    updated_at                     = now()
  WHERE id = p_org_id;
END;
$$;
