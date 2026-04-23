-- ============================================================
-- Restaurant reservations: party_size + cover cap + turn time
-- ============================================================
-- Applies ONLY to orgs where organizations.settings.business_category
-- is in ('restaurant','cafe','bar'). Non-restaurant orgs keep the
-- existing bookings-count capacity check unchanged.
--
-- Model:
--   - appointments.party_size (nullable): number of guests
--   - Per-slot COVER cap: sum of party_size within an overlapping
--     window must not exceed covers_per_interval (default 20)
--   - Turn time: a booking at T with party_size P blocks capacity
--     until T + turn_minutes(P)
--     Defaults: ≤2 → 90min, 3-4 → 120min, 5-6 → 150min, 7+ → 180min
--     Overridable via organizations.settings.reservation_turn_minutes
--     ({small, medium, large, xlarge})

-- 1. Column (nullable — legacy orgs untouched)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS party_size smallint
    CHECK (party_size IS NULL OR (party_size >= 1 AND party_size <= 50));

-- 2. Turn-time helper
CREATE OR REPLACE FUNCTION reservation_turn_minutes(
  p_party_size int,
  p_settings jsonb
)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_party_size IS NULL OR p_party_size <= 2
      THEN COALESCE((p_settings->'reservation_turn_minutes'->>'small')::int, 90)
    WHEN p_party_size <= 4
      THEN COALESCE((p_settings->'reservation_turn_minutes'->>'medium')::int, 120)
    WHEN p_party_size <= 6
      THEN COALESCE((p_settings->'reservation_turn_minutes'->>'large')::int, 150)
    ELSE COALESCE((p_settings->'reservation_turn_minutes'->>'xlarge')::int, 180)
  END;
$$;

-- 3. Replace capacity trigger with restaurant-aware branch
CREATE OR REPLACE FUNCTION check_slot_capacity()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
  org_settings jsonb;
  biz text;
  max_slots integer;
  current_count integer;
  max_covers integer;
  new_turn integer;
  new_end timestamptz;
  overlap_covers integer;
  daily_limit integer;
  daily_count integer;
BEGIN
  SELECT o.organization_id, g.settings
    INTO org_id, org_settings
    FROM offices o
    JOIN organizations g ON g.id = o.organization_id
    WHERE o.id = NEW.office_id;

  biz := COALESCE(org_settings->>'business_category', '');

  IF biz IN ('restaurant','cafe','bar') THEN
    -- Restaurant path: cover cap + turn-time overlap
    max_covers := COALESCE((org_settings->>'covers_per_interval')::integer, 20);
    new_turn := reservation_turn_minutes(COALESCE(NEW.party_size, 2), org_settings);
    new_end := NEW.scheduled_at + make_interval(mins => new_turn);

    SELECT COALESCE(SUM(COALESCE(a.party_size, 1)), 0)
      INTO overlap_covers
      FROM appointments a
      WHERE a.office_id = NEW.office_id
        AND a.status NOT IN ('cancelled', 'no_show', 'declined')
        AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND a.scheduled_at < new_end
        AND (a.scheduled_at + make_interval(
              mins => reservation_turn_minutes(COALESCE(a.party_size, 2), org_settings)
            )) > NEW.scheduled_at;

    IF overlap_covers + COALESCE(NEW.party_size, 1) > max_covers THEN
      RAISE EXCEPTION 'Slot is fully booked (% of % covers taken)', overlap_covers, max_covers;
    END IF;
  ELSE
    -- Legacy path: bookings-count per exact-minute slot (unchanged)
    SELECT COALESCE((org_settings->>'slots_per_interval')::integer, 1)
      INTO max_slots;

    SELECT COUNT(*)
      INTO current_count
      FROM appointments
      WHERE office_id = NEW.office_id
        AND service_id = NEW.service_id
        AND date_trunc('minute', scheduled_at) = date_trunc('minute', NEW.scheduled_at)
        AND status NOT IN ('cancelled')
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF current_count >= max_slots THEN
      RAISE EXCEPTION 'Slot is fully booked (% of % slots taken)', current_count, max_slots;
    END IF;
  END IF;

  -- Daily ticket limit (applies to both paths, unchanged)
  daily_limit := COALESCE((org_settings->>'daily_ticket_limit')::integer, 0);
  IF daily_limit > 0 THEN
    SELECT COUNT(*)
      INTO daily_count
      FROM appointments
      WHERE office_id = NEW.office_id
        AND (scheduled_at::date) = (NEW.scheduled_at::date)
        AND status NOT IN ('cancelled')
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF daily_count >= daily_limit THEN
      RAISE EXCEPTION 'Daily booking limit reached (% of % bookings)', daily_count, daily_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Partial index to speed overlap scans on active appointments
CREATE INDEX IF NOT EXISTS idx_appointments_office_time_active
  ON appointments(office_id, scheduled_at)
  WHERE status NOT IN ('cancelled', 'no_show', 'declined');
