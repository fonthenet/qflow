-- Ensure customer phones are always stored in LOCAL format (no country code).
-- This normalizes the phone in the upsert_customer_on_appointment trigger
-- and provides a reusable function for consistent phone normalization.

-- ============================================
-- 1. Phone-to-local normalizer function
-- ============================================

CREATE OR REPLACE FUNCTION normalize_phone_to_local(
  raw_phone text,
  office_id_input uuid DEFAULT NULL
) RETURNS text AS $$
DECLARE
  digits text;
  has_plus boolean;
  office_tz text;
  office_cc text;
  dial_code text;
  e164 text;
BEGIN
  IF raw_phone IS NULL OR trim(raw_phone) = '' THEN
    RETURN raw_phone;
  END IF;

  -- Strip non-digits, check for plus prefix
  has_plus := trim(raw_phone) LIKE '+%';
  digits := regexp_replace(trim(raw_phone), '[^0-9]', '', 'g');

  IF length(digits) < 7 THEN
    RETURN digits;
  END IF;

  -- Get office timezone/country for context
  IF office_id_input IS NOT NULL THEN
    SELECT
      COALESCE(org.timezone, o.timezone, 'Africa/Algiers'),
      o.settings->>'country_code'
    INTO office_tz, office_cc
    FROM offices o
    LEFT JOIN organizations org ON org.id = o.organization_id
    WHERE o.id = office_id_input;
  END IF;

  -- Determine the dial code
  dial_code := CASE upper(COALESCE(office_cc, ''))
    WHEN 'DZ' THEN '213' WHEN 'TN' THEN '216' WHEN 'MA' THEN '212'
    WHEN 'EG' THEN '20'  WHEN 'FR' THEN '33'  WHEN 'GB' THEN '44'
    WHEN 'US' THEN '1'   WHEN 'CA' THEN '1'   WHEN 'SA' THEN '966'
    WHEN 'AE' THEN '971'
    ELSE CASE COALESCE(office_tz, 'Africa/Algiers')
      WHEN 'Africa/Algiers' THEN '213' WHEN 'Africa/Tunis' THEN '216'
      WHEN 'Africa/Casablanca' THEN '212' WHEN 'Africa/Cairo' THEN '20'
      WHEN 'Europe/Paris' THEN '33' WHEN 'Europe/London' THEN '44'
      WHEN 'America/New_York' THEN '1' WHEN 'America/Chicago' THEN '1'
      WHEN 'America/Denver' THEN '1' WHEN 'America/Los_Angeles' THEN '1'
      WHEN 'America/Toronto' THEN '1'
      ELSE '213'
    END
  END;

  -- First: normalize to E.164
  IF has_plus THEN
    e164 := digits;
  ELSIF digits ~ '^00' THEN
    e164 := substring(digits from 3);
  ELSIF digits ~ '^0' AND dial_code IS NOT NULL THEN
    e164 := dial_code || substring(digits from 2);
  ELSIF dial_code IS NOT NULL AND digits LIKE dial_code || '%' AND length(digits) > length(dial_code) + 6 THEN
    e164 := digits;
  ELSIF length(digits) = 10 AND digits NOT LIKE '0%' THEN
    e164 := '1' || digits;
  ELSIF length(digits) = 9 AND dial_code = '213' THEN
    e164 := '213' || digits;
  ELSIF length(digits) = 9 AND dial_code = '33' THEN
    e164 := '33' || digits;
  ELSE
    e164 := digits;
  END IF;

  -- Second: convert E.164 back to local format (strip country code)
  -- Algeria (213)
  IF e164 ~ '^213' AND length(e164) = 12 THEN
    RETURN '0' || substring(e164 from 4);
  END IF;
  -- US/Canada (1)
  IF e164 ~ '^1' AND length(e164) = 11 THEN
    RETURN substring(e164 from 2);
  END IF;
  -- France (33)
  IF e164 ~ '^33' AND length(e164) = 11 THEN
    RETURN '0' || substring(e164 from 3);
  END IF;
  -- Morocco (212)
  IF e164 ~ '^212' AND length(e164) = 12 THEN
    RETURN '0' || substring(e164 from 4);
  END IF;
  -- Tunisia (216)
  IF e164 ~ '^216' AND length(e164) = 11 THEN
    RETURN substring(e164 from 4);
  END IF;
  -- Generic: if starts with known dial code, strip it and prepend 0
  IF dial_code IS NOT NULL AND e164 LIKE dial_code || '%' AND length(e164) > length(dial_code) + 6 THEN
    IF dial_code = '1' THEN
      RETURN substring(e164 from length(dial_code) + 1);
    ELSE
      RETURN '0' || substring(e164 from length(dial_code) + 1);
    END IF;
  END IF;

  RETURN digits;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- 2. Fix the customer upsert trigger to use local format
-- ============================================

CREATE OR REPLACE FUNCTION upsert_customer_on_appointment()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
  local_phone text;
BEGIN
  IF NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> '' THEN
    SELECT organization_id INTO org_id
    FROM offices WHERE id = NEW.office_id;

    IF org_id IS NOT NULL THEN
      -- Normalize phone to local format (no country code)
      local_phone := normalize_phone_to_local(NEW.customer_phone, NEW.office_id);

      INSERT INTO customers (organization_id, phone, name, email, booking_count, last_booking_at, source, updated_at)
      VALUES (
        org_id,
        local_phone,
        NEW.customer_name,
        NEW.customer_email,
        1,
        now(),
        'auto',
        now()
      )
      ON CONFLICT (organization_id, phone) DO UPDATE SET
        name = COALESCE(NULLIF(NEW.customer_name, ''), customers.name),
        email = COALESCE(NULLIF(NEW.customer_email, ''), customers.email),
        booking_count = customers.booking_count + 1,
        last_booking_at = now(),
        updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
