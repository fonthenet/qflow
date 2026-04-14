-- Fix: auto_register_ticket_customer trigger failed with duplicate key violation
-- when WhatsApp phone (E.164 format like 213669864728) didn't match existing
-- customer stored in local format (0669864728). The SELECT missed, then INSERT
-- hit the unique constraint (organization_id, phone).
--
-- Fix:
-- 1. Normalize E.164 to local format before lookup
-- 2. Search all phone format variants (raw, local, digits-only)
-- 3. Use ON CONFLICT DO UPDATE as safety net for race conditions

CREATE OR REPLACE FUNCTION auto_register_ticket_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org uuid; v_cid uuid; cd jsonb;
  v_name text; v_phone text; v_email text; v_gender text;
  v_dob date; v_blood text; v_file text; v_address text;
  v_wilaya text; v_city text; v_is_couple boolean;
  v_spouse_name text; v_spouse_dob date; v_spouse_blood text;
  v_spouse_gender text; v_marriage_date date; v_notes text;
  v_local_phone text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  cd := COALESCE(NEW.customer_data, '{}'::jsonb);
  v_name  := NULLIF(trim(COALESCE(cd->>'name','')),'');
  v_phone := NULLIF(trim(COALESCE(cd->>'phone','')),'');
  IF v_name IS NULL AND v_phone IS NULL THEN RETURN NEW; END IF;
  IF v_name ILIKE '%test%' OR v_phone ILIKE '%test%' THEN RETURN NEW; END IF;

  v_email         := NULLIF(trim(COALESCE(cd->>'email','')),'');
  v_gender        := NULLIF(trim(COALESCE(cd->>'gender','')),'');
  v_blood         := NULLIF(trim(COALESCE(cd->>'blood_type','')),'');
  v_file          := NULLIF(trim(COALESCE(cd->>'file_number','')),'');
  v_address       := NULLIF(trim(COALESCE(cd->>'address','')),'');
  v_wilaya        := NULLIF(trim(COALESCE(cd->>'wilaya_code','')),'');
  v_city          := NULLIF(trim(COALESCE(cd->>'city','')),'');
  v_spouse_name   := NULLIF(trim(COALESCE(cd->>'spouse_name','')),'');
  v_spouse_blood  := NULLIF(trim(COALESCE(cd->>'spouse_blood_type','')),'');
  v_spouse_gender := NULLIF(trim(COALESCE(cd->>'spouse_gender','')),'');
  v_notes         := NULLIF(trim(COALESCE(cd->>'notes','')),'');
  v_is_couple     := CASE WHEN cd ? 'is_couple' THEN (cd->>'is_couple')::boolean ELSE NULL END;
  BEGIN v_dob := NULLIF(cd->>'date_of_birth','')::date; EXCEPTION WHEN OTHERS THEN v_dob := NULL; END;
  BEGIN v_spouse_dob := NULLIF(cd->>'spouse_dob','')::date; EXCEPTION WHEN OTHERS THEN v_spouse_dob := NULL; END;
  BEGIN v_marriage_date := NULLIF(cd->>'marriage_date','')::date; EXCEPTION WHEN OTHERS THEN v_marriage_date := NULL; END;

  SELECT organization_id INTO v_org FROM offices WHERE id = NEW.office_id;
  IF v_org IS NULL THEN RETURN NEW; END IF;

  -- Normalize phone: convert E.164 to local format for consistent matching
  -- E.g. 213669864728 → 0669864728, 33612345678 → 0612345678
  v_local_phone := v_phone;
  IF v_phone IS NOT NULL THEN
    v_local_phone := regexp_replace(v_phone, '[^0-9]', '', 'g');
    IF v_local_phone LIKE '213%' AND length(v_local_phone) = 12 THEN
      v_local_phone := '0' || substring(v_local_phone from 4);
    ELSIF v_local_phone LIKE '33%' AND length(v_local_phone) = 11 THEN
      v_local_phone := '0' || substring(v_local_phone from 3);
    ELSIF v_local_phone LIKE '212%' AND length(v_local_phone) = 12 THEN
      v_local_phone := '0' || substring(v_local_phone from 4);
    ELSIF v_local_phone LIKE '216%' AND length(v_local_phone) = 11 THEN
      v_local_phone := substring(v_local_phone from 4);
    ELSIF v_local_phone LIKE '1%' AND length(v_local_phone) = 11 THEN
      v_local_phone := substring(v_local_phone from 2);
    END IF;
  END IF;

  -- Try to find existing customer by any phone format variant
  IF v_local_phone IS NOT NULL THEN
    SELECT id INTO v_cid FROM customers
    WHERE organization_id = v_org
      AND phone IN (v_phone, v_local_phone, regexp_replace(v_phone, '[^0-9]', '', 'g'))
    LIMIT 1;
  END IF;

  IF v_cid IS NULL THEN
    -- Use ON CONFLICT to handle race conditions
    INSERT INTO customers (organization_id, name, phone, email, gender, date_of_birth, blood_type, file_number, address, wilaya_code, city, is_couple, spouse_name, spouse_dob, spouse_blood_type, spouse_gender, marriage_date, notes, source, visit_count, last_visit_at, created_at, updated_at)
    VALUES (v_org, COALESCE(v_name,'Walk-in'), v_local_phone, v_email, v_gender, v_dob, v_blood, v_file, v_address, v_wilaya, v_city, v_is_couple, v_spouse_name, v_spouse_dob, v_spouse_blood, v_spouse_gender, v_marriage_date, v_notes, 'walk_in', 1, now(), now(), now())
    ON CONFLICT (organization_id, phone) DO UPDATE SET
      visit_count = COALESCE(customers.visit_count, 0) + 1,
      last_visit_at = now(),
      name = CASE WHEN (customers.name IS NULL OR customers.name = '' OR customers.name = 'Walk-in') AND v_name IS NOT NULL THEN v_name ELSE customers.name END,
      email = COALESCE(customers.email, EXCLUDED.email),
      gender = COALESCE(customers.gender, EXCLUDED.gender),
      date_of_birth = COALESCE(customers.date_of_birth, EXCLUDED.date_of_birth),
      blood_type = COALESCE(customers.blood_type, EXCLUDED.blood_type),
      file_number = COALESCE(customers.file_number, EXCLUDED.file_number),
      address = COALESCE(customers.address, EXCLUDED.address),
      wilaya_code = COALESCE(customers.wilaya_code, EXCLUDED.wilaya_code),
      city = COALESCE(customers.city, EXCLUDED.city),
      is_couple = COALESCE(customers.is_couple, EXCLUDED.is_couple),
      spouse_name = COALESCE(customers.spouse_name, EXCLUDED.spouse_name),
      spouse_dob = COALESCE(customers.spouse_dob, EXCLUDED.spouse_dob),
      spouse_blood_type = COALESCE(customers.spouse_blood_type, EXCLUDED.spouse_blood_type),
      spouse_gender = COALESCE(customers.spouse_gender, EXCLUDED.spouse_gender),
      marriage_date = COALESCE(customers.marriage_date, EXCLUDED.marriage_date),
      notes = COALESCE(customers.notes, EXCLUDED.notes),
      updated_at = now()
    RETURNING id INTO v_cid;
  ELSE
    UPDATE customers SET visit_count=COALESCE(visit_count,0)+1, last_visit_at=now(),
      name=CASE WHEN (name IS NULL OR name='' OR name='Walk-in') AND v_name IS NOT NULL THEN v_name ELSE name END,
      email=COALESCE(email,v_email), gender=COALESCE(gender,v_gender), date_of_birth=COALESCE(date_of_birth,v_dob),
      blood_type=COALESCE(blood_type,v_blood), file_number=COALESCE(file_number,v_file), address=COALESCE(address,v_address),
      wilaya_code=COALESCE(wilaya_code,v_wilaya), city=COALESCE(city,v_city), is_couple=COALESCE(is_couple,v_is_couple),
      spouse_name=COALESCE(spouse_name,v_spouse_name), spouse_dob=COALESCE(spouse_dob,v_spouse_dob),
      spouse_blood_type=COALESCE(spouse_blood_type,v_spouse_blood), spouse_gender=COALESCE(spouse_gender,v_spouse_gender),
      marriage_date=COALESCE(marriage_date,v_marriage_date), notes=COALESCE(notes,v_notes), updated_at=now()
    WHERE id = v_cid;
  END IF;

  NEW.customer_id := v_cid;
  RETURN NEW;
END;
$$;
