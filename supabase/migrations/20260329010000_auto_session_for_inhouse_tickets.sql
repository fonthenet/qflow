-- Auto-create a whatsapp_sessions record for in-house tickets that have a phone number.
-- This enables WhatsApp notifications (called, serving, etc.) for walk-in customers
-- whose phone number was captured at the Station.

CREATE OR REPLACE FUNCTION auto_create_whatsapp_session_for_ticket()
RETURNS trigger AS $$
DECLARE
  raw_phone text;
  normalized_phone text;
BEGIN
  -- Only for new tickets with customer_data containing a phone
  raw_phone := NEW.customer_data ->> 'phone';
  IF raw_phone IS NULL OR trim(raw_phone) = '' THEN
    RETURN NEW;
  END IF;

  -- Skip if a session already exists for this ticket (e.g. WhatsApp/Messenger join)
  IF EXISTS (SELECT 1 FROM whatsapp_sessions WHERE ticket_id = NEW.id AND state = 'active') THEN
    RETURN NEW;
  END IF;

  -- Normalize Algerian phone numbers: 0561... → 213561...
  normalized_phone := regexp_replace(trim(raw_phone), '[^0-9+]', '', 'g');
  -- Remove leading + if present
  normalized_phone := regexp_replace(normalized_phone, '^\+', '');
  -- Convert local format (0xx) to international (213xx)
  IF normalized_phone ~ '^0[567]' THEN
    normalized_phone := '213' || substring(normalized_phone from 2);
  END IF;

  -- Must have enough digits to be a valid phone
  IF length(normalized_phone) < 9 THEN
    RETURN NEW;
  END IF;

  INSERT INTO whatsapp_sessions (
    organization_id,
    whatsapp_phone,
    ticket_id,
    office_id,
    department_id,
    service_id,
    channel,
    state,
    locale
  ) VALUES (
    NEW.organization_id,
    normalized_phone,
    NEW.id,
    NEW.office_id,
    NEW.department_id,
    NEW.service_id,
    'whatsapp',
    'active',
    'ar'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire AFTER insert so the ticket row is committed first
DROP TRIGGER IF EXISTS trg_auto_session_for_ticket ON tickets;
CREATE TRIGGER trg_auto_session_for_ticket
  AFTER INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_whatsapp_session_for_ticket();
