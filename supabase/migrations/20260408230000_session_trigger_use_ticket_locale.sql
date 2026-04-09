-- Auto-created session must inherit the ticket's locale (set at booking time)
-- so subsequent lifecycle notifications (called/served/etc.) speak the
-- customer's actual language. Previously hardcoded to 'fr'.

CREATE OR REPLACE FUNCTION auto_create_notification_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_phone text;
  v_org_id uuid;
  v_tz text;
  v_country_code text;
  v_dial_code text;
  v_normalized text;
  v_locale text;
BEGIN
  IF NEW.source IN ('whatsapp', 'messenger') THEN
    RETURN NEW;
  END IF;

  v_phone := trim(COALESCE(NEW.customer_data->>'phone', ''));
  IF v_phone = '' THEN
    RETURN NEW;
  END IF;

  SELECT o.organization_id, COALESCE(o.timezone, 'UTC'), o.settings->>'country_code'
    INTO v_org_id, v_tz, v_country_code
    FROM offices o WHERE o.id = NEW.office_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_normalized := regexp_replace(v_phone, '[^0-9]', '', 'g');

  v_dial_code := CASE v_country_code
    WHEN 'DZ' THEN '213' WHEN 'MA' THEN '212' WHEN 'TN' THEN '216'
    WHEN 'FR' THEN '33' WHEN 'US' THEN '1' WHEN 'GB' THEN '44'
    WHEN 'SA' THEN '966' WHEN 'AE' THEN '971' WHEN 'EG' THEN '20'
    ELSE NULL
  END;

  IF v_dial_code IS NOT NULL THEN
    IF v_normalized LIKE '0%' THEN
      v_normalized := v_dial_code || substring(v_normalized from 2);
    ELSIF v_dial_code = '1' AND length(v_normalized) = 10
          AND v_normalized NOT LIKE '0%' AND v_normalized NOT LIKE '1%' THEN
      v_normalized := '1' || v_normalized;
    END IF;
  END IF;

  IF length(v_normalized) < 7 THEN
    RETURN NEW;
  END IF;

  v_locale := CASE WHEN NEW.locale IN ('ar','en','fr') THEN NEW.locale ELSE 'fr' END;

  INSERT INTO whatsapp_sessions (
    organization_id, ticket_id, office_id, department_id, service_id,
    whatsapp_phone, channel, state, locale
  ) VALUES (
    v_org_id, NEW.id, NEW.office_id, NEW.department_id, NEW.service_id,
    v_normalized, 'whatsapp', 'active', v_locale
  ) ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
