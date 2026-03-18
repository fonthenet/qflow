-- Queue Resilience System
-- Desk heartbeats, offline sync queue, recovery cron, booking priority, one-active guard

-- 1. Desk Heartbeat table
CREATE TABLE IF NOT EXISTS desk_heartbeats (
  desk_id uuid PRIMARY KEY REFERENCES desks(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  last_ping timestamptz NOT NULL DEFAULT now(),
  is_online boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_desk_heartbeats_last_ping ON desk_heartbeats(last_ping);
ALTER TABLE desk_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on desk_heartbeats"
  ON desk_heartbeats FOR ALL USING (true) WITH CHECK (true);

-- 2. Offline sync queue
CREATE TABLE IF NOT EXISTS offline_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE NOT NULL,
  office_id uuid NOT NULL REFERENCES offices(id),
  desk_id uuid REFERENCES desks(id),
  staff_id uuid REFERENCES staff(id),
  action text NOT NULL,
  ticket_id uuid REFERENCES tickets(id),
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending',
  conflict_reason text,
  retry_count int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_offline_sync_pending ON offline_sync_queue(sync_status) WHERE sync_status = 'pending';
ALTER TABLE offline_sync_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on offline_sync_queue"
  ON offline_sync_queue FOR ALL USING (true) WITH CHECK (true);

-- 3. Recovery function
CREATE OR REPLACE FUNCTION recover_stuck_tickets()
RETURNS jsonb AS $$
DECLARE
  v_requeued int := 0;
  v_parked int := 0;
  v_cancelled int := 0;
  v_desks_offlined int := 0;
BEGIN
  WITH requeued AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND called_at < now() - interval '2 minutes'
    RETURNING id
  ) SELECT count(*) INTO v_requeued FROM requeued;

  WITH parked AS (
    UPDATE tickets SET parked_at = now(), notes = COALESCE(notes, '') || ' [Auto-parked: 4h timeout]'
    WHERE status = 'serving' AND serving_started_at < now() - interval '4 hours' AND parked_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_parked FROM parked;

  WITH cancelled AS (
    UPDATE tickets SET status = 'cancelled', notes = COALESCE(notes, '') || ' [Auto-cancelled: end of day]'
    WHERE status = 'waiting' AND created_at < (CURRENT_DATE AT TIME ZONE 'UTC')
    RETURNING id
  ) SELECT count(*) INTO v_cancelled FROM cancelled;

  WITH stale_desks AS (
    UPDATE desk_heartbeats SET is_online = false
    WHERE last_ping < now() - interval '3 minutes' AND is_online = true
    RETURNING desk_id
  ),
  requeued_from_desks AS (
    UPDATE tickets SET status = 'waiting', desk_id = NULL, called_at = NULL, called_by_staff_id = NULL
    WHERE status = 'called' AND desk_id IN (SELECT desk_id FROM stale_desks)
    RETURNING id
  ) SELECT count(*) INTO v_desks_offlined FROM stale_desks;

  RETURN jsonb_build_object(
    'requeued_stale_called', v_requeued, 'parked_stale_serving', v_parked,
    'cancelled_yesterday', v_cancelled, 'desks_offlined', v_desks_offlined, 'recovered_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Heartbeat upsert
CREATE OR REPLACE FUNCTION desk_heartbeat(p_desk_id uuid, p_staff_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO desk_heartbeats (desk_id, staff_id, last_ping, is_online)
  VALUES (p_desk_id, p_staff_id, now(), true)
  ON CONFLICT (desk_id) DO UPDATE SET last_ping = now(), staff_id = p_staff_id, is_online = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Time-aware booking priority
CREATE OR REPLACE FUNCTION update_booking_priorities()
RETURNS int AS $$
DECLARE v_updated int := 0;
BEGIN
  WITH updated AS (
    UPDATE tickets t SET priority = CASE
      WHEN a.scheduled_at < now() THEN 7
      WHEN a.scheduled_at < now() + interval '15 minutes' THEN 5
      ELSE 1
    END
    FROM appointments a
    WHERE t.appointment_id = a.id AND t.status = 'waiting'
      AND t.priority != CASE
        WHEN a.scheduled_at < now() THEN 7
        WHEN a.scheduled_at < now() + interval '15 minutes' THEN 5
        ELSE 1
      END
    RETURNING t.id
  ) SELECT count(*) INTO v_updated FROM updated;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. One-active-ticket-per-desk guard
CREATE OR REPLACE FUNCTION enforce_one_active_per_desk()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'called' AND NEW.desk_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM tickets WHERE desk_id = NEW.desk_id AND id != NEW.id AND status IN ('called', 'serving')) THEN
      RAISE EXCEPTION 'Desk already has an active ticket';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_active_per_desk ON tickets;
CREATE TRIGGER trg_one_active_per_desk BEFORE UPDATE ON tickets
  FOR EACH ROW WHEN (NEW.status = 'called') EXECUTE FUNCTION enforce_one_active_per_desk();

-- 7. Cron jobs (every minute)
SELECT cron.schedule('recover-stuck-tickets', '* * * * *', $$SELECT recover_stuck_tickets();$$);
SELECT cron.schedule('update-booking-priorities', '* * * * *', $$SELECT update_booking_priorities();$$);
