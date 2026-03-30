-- Replace hardcoded 'Bearer internal-trigger' with vault-stored secret
-- The secret is stored in Supabase Vault as 'internal_webhook_secret'
-- and read at runtime by the SECURITY DEFINER function.

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
  v_webhook_secret text;
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
  SELECT o.organization_id, COALESCE(o.timezone, 'UTC'), o.settings->>'country_code'
    INTO v_org_id, v_tz, v_country_code
    FROM offices o WHERE o.id = NEW.office_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Normalize phone number
  v_normalized := regexp_replace(v_phone, '[^0-9]', '', 'g');

  -- Country dial code lookup
  v_dial_code := CASE v_country_code
    WHEN 'DZ' THEN '213' WHEN 'MA' THEN '212' WHEN 'TN' THEN '216'
    WHEN 'FR' THEN '33' WHEN 'US' THEN '1' WHEN 'GB' THEN '44'
    WHEN 'SA' THEN '966' WHEN 'AE' THEN '971' WHEN 'EG' THEN '20'
    ELSE NULL
  END;

  -- Apply dial code if local number starts with 0
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

  -- Read webhook secret from vault (falls back to legacy token if not set)
  SELECT decrypted_secret INTO v_webhook_secret
    FROM vault.decrypted_secrets WHERE name = 'internal_webhook_secret';

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
      'Authorization', 'Bearer ' || COALESCE(v_webhook_secret, 'internal-trigger')
    )
  );

  RETURN NEW;
END;
$$;
