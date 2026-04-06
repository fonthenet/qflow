-- Fix phone normalization in auto_create_whatsapp_session_for_ticket trigger.
-- Previous version only handled Algerian local numbers (0xx → 213xx).
-- This version handles international numbers properly using office settings.

CREATE OR REPLACE FUNCTION auto_create_whatsapp_session_for_ticket()
RETURNS trigger AS $$
DECLARE
  raw_phone text;
  normalized_phone text;
  digits text;
  has_plus boolean;
  office_tz text;
  office_cc text;
  dial_code text;
  office_locale text;
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

  -- Get office timezone and country code for normalization
  SELECT o.timezone, o.settings->>'country_code', COALESCE(o.settings->>'locale', 'fr')
    INTO office_tz, office_cc, office_locale
    FROM offices o WHERE o.id = NEW.office_id;

  -- Strip non-digits, check for plus prefix
  has_plus := trim(raw_phone) LIKE '+%';
  digits := regexp_replace(trim(raw_phone), '[^0-9]', '', 'g');

  -- Must have enough digits
  IF length(digits) < 7 THEN
    RETURN NEW;
  END IF;

  -- If had + prefix, digits are already international
  IF has_plus THEN
    normalized_phone := digits;
  ELSE
    -- Determine dial code from office settings
    dial_code := CASE upper(COALESCE(office_cc, ''))
      WHEN 'DZ' THEN '213' WHEN 'TN' THEN '216' WHEN 'MA' THEN '212'
      WHEN 'EG' THEN '20'  WHEN 'FR' THEN '33'  WHEN 'GB' THEN '44'
      WHEN 'US' THEN '1'   WHEN 'CA' THEN '1'   WHEN 'SA' THEN '966'
      WHEN 'AE' THEN '971'
      ELSE CASE office_tz
        WHEN 'Africa/Algiers' THEN '213' WHEN 'Africa/Tunis' THEN '216'
        WHEN 'Africa/Casablanca' THEN '212' WHEN 'Africa/Cairo' THEN '20'
        WHEN 'Europe/Paris' THEN '33' WHEN 'Europe/London' THEN '44'
        WHEN 'America/New_York' THEN '1' WHEN 'America/Chicago' THEN '1'
        WHEN 'America/Denver' THEN '1' WHEN 'America/Los_Angeles' THEN '1'
        WHEN 'America/Toronto' THEN '1'
        ELSE NULL
      END
    END;

    -- Local format: 0xx → dial_code + xx
    IF digits ~ '^0' AND dial_code IS NOT NULL THEN
      normalized_phone := dial_code || substring(digits from 2);
    -- Already has country code prefix
    ELSIF dial_code IS NOT NULL AND digits LIKE dial_code || '%' AND length(digits) > length(dial_code) + 6 THEN
      normalized_phone := digits;
    -- 10-digit number without leading 0 → assume US/CA
    ELSIF length(digits) = 10 AND digits NOT LIKE '0%' THEN
      normalized_phone := '1' || digits;
    -- 9-digit Algerian number
    ELSIF length(digits) = 9 AND dial_code = '213' THEN
      normalized_phone := '213' || digits;
    -- 9-digit French number
    ELSIF length(digits) = 9 AND dial_code = '33' THEN
      normalized_phone := '33' || digits;
    -- Short number with known dial code
    ELSIF dial_code IS NOT NULL AND length(digits) <= 9 THEN
      normalized_phone := dial_code || digits;
    ELSE
      normalized_phone := digits;
    END IF;
  END IF;

  -- Final length check
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
    COALESCE(office_locale, 'fr')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
