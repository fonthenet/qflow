-- Fix: auto_create_notification_session was calling stale qflow-sigma.vercel.app URL
-- which returns DEPLOYMENT_NOT_FOUND. Changed to qflo.net (the custom domain).
-- Also applied directly via execute_sql since this is urgent.

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
  v_payload jsonb;
BEGIN
  -- Skip if source is whatsapp or messenger (handled by messaging flow)
  IF NEW.source IN ('whatsapp', 'messenger') THEN
    RETURN NEW;
  END IF;

  -- Extract phone from customer_data
  v_phone := trim(COALESCE(NEW.customer_data->>'phone', ''));
  IF v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- Get office org_id, timezone, and country_code from settings
  SELECT o.organization_id, o.timezone,
         COALESCE(o.settings->>'country_code', o.country)
  INTO v_org_id, v_tz, v_country_code
  FROM offices o WHERE o.id = NEW.office_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize phone: strip non-digits
  v_normalized := regexp_replace(v_phone, '[^\d]', '', 'g');

  -- Resolve dial code from country_code or timezone
  v_dial_code := CASE
    WHEN upper(v_country_code) = 'DZ' THEN '213'
    WHEN upper(v_country_code) = 'TN' THEN '216'
    WHEN upper(v_country_code) = 'MA' THEN '212'
    WHEN upper(v_country_code) = 'EG' THEN '20'
    WHEN upper(v_country_code) = 'FR' THEN '33'
    WHEN upper(v_country_code) = 'GB' THEN '44'
    WHEN upper(v_country_code) = 'DE' THEN '49'
    WHEN upper(v_country_code) = 'ES' THEN '34'
    WHEN upper(v_country_code) = 'IT' THEN '39'
    WHEN upper(v_country_code) = 'BE' THEN '32'
    WHEN upper(v_country_code) = 'NL' THEN '31'
    WHEN upper(v_country_code) = 'CH' THEN '41'
    WHEN upper(v_country_code) = 'TR' THEN '90'
    WHEN upper(v_country_code) = 'SA' THEN '966'
    WHEN upper(v_country_code) = 'AE' THEN '971'
    WHEN upper(v_country_code) = 'QA' THEN '974'
    WHEN upper(v_country_code) = 'KW' THEN '965'
    WHEN upper(v_country_code) = 'BH' THEN '973'
    WHEN upper(v_country_code) = 'OM' THEN '968'
    WHEN upper(v_country_code) = 'JO' THEN '962'
    WHEN upper(v_country_code) = 'LB' THEN '961'
    WHEN upper(v_country_code) = 'IQ' THEN '964'
    WHEN upper(v_country_code) = 'US' THEN '1'
    WHEN upper(v_country_code) = 'CA' THEN '1'
    WHEN upper(v_country_code) = 'MX' THEN '52'
    WHEN upper(v_country_code) = 'BR' THEN '55'
    WHEN upper(v_country_code) = 'IN' THEN '91'
    WHEN upper(v_country_code) = 'AU' THEN '61'
    WHEN v_tz = 'Africa/Algiers' THEN '213'
    WHEN v_tz = 'Africa/Tunis' THEN '216'
    WHEN v_tz = 'Africa/Casablanca' THEN '212'
    WHEN v_tz = 'Africa/Cairo' THEN '20'
    WHEN v_tz = 'Europe/Paris' THEN '33'
    WHEN v_tz = 'Europe/London' THEN '44'
    WHEN v_tz LIKE 'America/%' THEN '1'
    WHEN v_tz = 'Asia/Riyadh' THEN '966'
    WHEN v_tz = 'Asia/Dubai' THEN '971'
    WHEN v_tz = 'Asia/Beirut' THEN '961'
    ELSE NULL
  END;

  -- Apply normalization rules
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

  -- Insert session
  INSERT INTO whatsapp_sessions (
    organization_id, ticket_id, office_id, department_id, service_id,
    whatsapp_phone, channel, state, locale
  ) VALUES (
    v_org_id, NEW.id, NEW.office_id, NEW.department_id, NEW.service_id,
    v_normalized, 'whatsapp', 'active', 'fr'
  ) ON CONFLICT DO NOTHING;

  -- Send "joined" confirmation via whatsapp-send API
  v_payload := jsonb_build_object(
    'ticketId', NEW.id,
    'event', 'joined',
    'deskName', ''
  );

  PERFORM net.http_post(
    url := 'https://qflo.net/api/whatsapp-send',
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer internal-trigger'
    )
  );

  RETURN NEW;
END;
$$;
