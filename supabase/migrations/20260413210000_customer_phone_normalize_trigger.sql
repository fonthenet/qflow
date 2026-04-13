-- Trigger to normalize customer phone numbers to local format on INSERT/UPDATE.
-- This is the DB-level safety net: even if application code passes a phone
-- with a country code (e.g. "213669864728"), the trigger strips it to local
-- format ("0669864728") before storage, preventing duplicates.

CREATE OR REPLACE FUNCTION normalize_customer_phone()
RETURNS TRIGGER AS $$
DECLARE
  org_tz text;
  dial_code text;
  digits text;
  e164 text;
  has_plus boolean;
BEGIN
  -- Skip if phone is null or empty
  IF NEW.phone IS NULL OR trim(NEW.phone) = '' THEN
    RETURN NEW;
  END IF;

  -- Get the org timezone for dial-code resolution
  SELECT COALESCE(timezone, 'Africa/Algiers') INTO org_tz
  FROM organizations WHERE id = NEW.organization_id;

  org_tz := COALESCE(org_tz, 'Africa/Algiers');

  -- Determine the dial code from timezone
  dial_code := CASE org_tz
    WHEN 'Africa/Algiers' THEN '213' WHEN 'Africa/Tunis' THEN '216'
    WHEN 'Africa/Casablanca' THEN '212' WHEN 'Africa/Cairo' THEN '20'
    WHEN 'Europe/Paris' THEN '33' WHEN 'Europe/London' THEN '44'
    WHEN 'America/New_York' THEN '1' WHEN 'America/Chicago' THEN '1'
    WHEN 'America/Denver' THEN '1' WHEN 'America/Los_Angeles' THEN '1'
    WHEN 'America/Toronto' THEN '1'
    WHEN 'Asia/Riyadh' THEN '966' WHEN 'Asia/Dubai' THEN '971'
    WHEN 'Asia/Beirut' THEN '961'
    ELSE '213'
  END;

  -- Strip non-digits, check for plus prefix
  has_plus := trim(NEW.phone) LIKE '+%';
  digits := regexp_replace(trim(NEW.phone), '[^0-9]', '', 'g');

  IF length(digits) < 7 THEN
    NEW.phone := digits;
    RETURN NEW;
  END IF;

  -- Normalize to E.164 first
  IF has_plus THEN
    e164 := digits;
  ELSIF digits ~ '^00' THEN
    e164 := substring(digits from 3);
  ELSIF digits ~ '^0' AND dial_code IS NOT NULL THEN
    -- Local format with leading 0: already local, just strip non-digits
    NEW.phone := digits;
    RETURN NEW;
  ELSIF dial_code IS NOT NULL AND digits LIKE dial_code || '%' AND length(digits) > length(dial_code) + 6 THEN
    e164 := digits;
  ELSIF length(digits) = 10 AND digits NOT LIKE '0%' THEN
    e164 := '1' || digits;
  ELSIF length(digits) = 9 AND dial_code = '213' THEN
    e164 := '213' || digits;
  ELSIF length(digits) = 9 AND dial_code = '33' THEN
    e164 := '33' || digits;
  ELSE
    NEW.phone := digits;
    RETURN NEW;
  END IF;

  -- Convert E.164 back to local format (strip country code)
  -- Algeria (213)
  IF e164 ~ '^213' AND length(e164) = 12 THEN
    NEW.phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  -- US/Canada (1)
  IF e164 ~ '^1' AND length(e164) = 11 THEN
    NEW.phone := substring(e164 from 2);
    RETURN NEW;
  END IF;
  -- France (33)
  IF e164 ~ '^33' AND length(e164) = 11 THEN
    NEW.phone := '0' || substring(e164 from 3);
    RETURN NEW;
  END IF;
  -- Morocco (212)
  IF e164 ~ '^212' AND length(e164) = 12 THEN
    NEW.phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  -- Tunisia (216)
  IF e164 ~ '^216' AND length(e164) = 11 THEN
    NEW.phone := substring(e164 from 4);
    RETURN NEW;
  END IF;
  -- Generic: if starts with known dial code, strip it
  IF dial_code IS NOT NULL AND e164 LIKE dial_code || '%' AND length(e164) > length(dial_code) + 6 THEN
    IF dial_code = '1' THEN
      NEW.phone := substring(e164 from length(dial_code) + 1);
    ELSE
      NEW.phone := '0' || substring(e164 from length(dial_code) + 1);
    END IF;
    RETURN NEW;
  END IF;

  NEW.phone := digits;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger fires BEFORE insert/update so the phone is normalized before
-- the unique constraint (organization_id, phone) is checked
DROP TRIGGER IF EXISTS trg_normalize_customer_phone ON customers;
CREATE TRIGGER trg_normalize_customer_phone
  BEFORE INSERT OR UPDATE OF phone ON customers
  FOR EACH ROW
  EXECUTE FUNCTION normalize_customer_phone();
