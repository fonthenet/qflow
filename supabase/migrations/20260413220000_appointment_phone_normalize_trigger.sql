-- Normalize appointment customer_phone to local format on INSERT/UPDATE.
-- Mirrors the customer phone trigger — strips country codes so phones
-- are always displayed without 1/213/33 etc.

CREATE OR REPLACE FUNCTION normalize_appointment_phone()
RETURNS TRIGGER AS $$
DECLARE
  org_tz text;
  dial_code text;
  digits text;
  e164 text;
  has_plus boolean;
BEGIN
  IF NEW.customer_phone IS NULL OR trim(NEW.customer_phone) = '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(org.timezone, o.timezone, 'Africa/Algiers') INTO org_tz
  FROM offices o
  LEFT JOIN organizations org ON org.id = o.organization_id
  WHERE o.id = NEW.office_id;
  org_tz := COALESCE(org_tz, 'Africa/Algiers');

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

  has_plus := trim(NEW.customer_phone) LIKE '+%';
  digits := regexp_replace(trim(NEW.customer_phone), '[^0-9]', '', 'g');

  IF length(digits) < 7 THEN
    NEW.customer_phone := digits;
    RETURN NEW;
  END IF;

  IF has_plus THEN
    e164 := digits;
  ELSIF digits ~ '^00' THEN
    e164 := substring(digits from 3);
  ELSIF digits ~ '^0' AND dial_code IS NOT NULL THEN
    NEW.customer_phone := digits;
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
    e164 := digits;
  END IF;

  IF e164 ~ '^1[2-9]' AND length(e164) = 11 THEN
    NEW.customer_phone := substring(e164 from 2);
    RETURN NEW;
  END IF;
  IF e164 ~ '^213' AND length(e164) = 12 THEN
    NEW.customer_phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  IF e164 ~ '^33' AND length(e164) = 11 THEN
    NEW.customer_phone := '0' || substring(e164 from 3);
    RETURN NEW;
  END IF;
  IF e164 ~ '^212' AND length(e164) = 12 THEN
    NEW.customer_phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  IF e164 ~ '^216' AND length(e164) = 11 THEN
    NEW.customer_phone := substring(e164 from 4);
    RETURN NEW;
  END IF;
  IF e164 ~ '^20' AND length(e164) = 12 THEN
    NEW.customer_phone := '0' || substring(e164 from 3);
    RETURN NEW;
  END IF;
  IF e164 ~ '^966' AND length(e164) = 12 THEN
    NEW.customer_phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  IF e164 ~ '^971' AND length(e164) = 12 THEN
    NEW.customer_phone := '0' || substring(e164 from 4);
    RETURN NEW;
  END IF;
  IF dial_code IS NOT NULL AND e164 LIKE dial_code || '%' AND length(e164) > length(dial_code) + 6 THEN
    IF dial_code = '1' THEN
      NEW.customer_phone := substring(e164 from length(dial_code) + 1);
    ELSE
      NEW.customer_phone := '0' || substring(e164 from length(dial_code) + 1);
    END IF;
    RETURN NEW;
  END IF;

  NEW.customer_phone := digits;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_normalize_appointment_phone ON appointments;
CREATE TRIGGER trg_normalize_appointment_phone
  BEFORE INSERT OR UPDATE OF customer_phone ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION normalize_appointment_phone();
