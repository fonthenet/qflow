-- =============================================================================
-- Migration: payment_events_retention
-- =============================================================================
-- Purpose: PII retention + minimization policy for payment_events.raw_payload.
--
-- Retention windows:
--   0–7 days   : full raw_payload retained (operational window for debugging).
--   7–730 days : minimized payload only — PII fields stripped, financial
--                fields kept for reconciliation audit trail.
--   730+ days  : row hard-deleted (webhook event level; ledger data lives in
--                ticket_payments which has its own retention schedule).
--
-- Fields minimized (stripped from raw_payload after 7 days):
--   customer_email, receipt_email, billing_details, shipping,
--   charges.data[].billing_details, charges.data[].source,
--   anything under data.object containing: email, name, phone, address,
--   tax_id, ssn, dob, card.fingerprint, card.last4, card.exp_month,
--   card.exp_year, card.exp_*, card.network.
--
-- Legal basis:
--   GDPR Art. 5(1)(e) — storage limitation principle.
--   DPDP (India) Sec. 8(7) — retention limited to necessary period.
--   Algeria Loi 18-07 Art. 8 — données à caractère personnel / durée minimale.
--
-- Rollback:
--   SELECT cron.unschedule('minimize-payment-events');
--   SELECT cron.unschedule('purge-payment-events');
--   DROP FUNCTION IF EXISTS minimize_payment_events();
--   DROP FUNCTION IF EXISTS purge_payment_events();
--   ALTER TABLE public.payment_events
--     DROP COLUMN IF EXISTS minimized_at,
--     DROP COLUMN IF EXISTS purged_at;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS minimized_at timestamptz,
  ADD COLUMN IF NOT EXISTS purged_at    timestamptz;

-- Index so the daily cron finds eligible rows fast (processed + old + not yet minimized).
CREATE INDEX IF NOT EXISTS idx_payment_events_minimization_eligible
  ON public.payment_events (received_at)
  WHERE processed_at IS NOT NULL AND minimized_at IS NULL;

-- Index for the monthly purge scan.
CREATE INDEX IF NOT EXISTS idx_payment_events_purge_eligible
  ON public.payment_events (received_at)
  WHERE purged_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. minimize_payment_events()
--    Strips PII from raw_payload for rows older than 7 days.
--    Returns number of rows minimized.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.minimize_payment_events()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int := 0;
  r       RECORD;
  obj     jsonb;
  card    jsonb;
  charges jsonb;
  i       int;
  clean_charge jsonb;
  clean_charges jsonb;
BEGIN
  FOR r IN
    SELECT id, raw_payload
    FROM public.payment_events
    WHERE processed_at IS NOT NULL
      AND minimized_at IS NULL
      AND received_at < now() - interval '7 days'
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Start with only the top-level keys we want to keep.
    -- type, id, created, livemode, api_version are safe scalar fields.
    obj := jsonb_build_object(
      'type',        r.raw_payload -> 'type',
      'id',          r.raw_payload -> 'id',
      'created',     r.raw_payload -> 'created',
      'livemode',    r.raw_payload -> 'livemode',
      'api_version', r.raw_payload -> 'api_version'
    );

    -- Reconstruct data.object keeping only financial + operational fields.
    IF r.raw_payload ? 'data' AND r.raw_payload -> 'data' ? 'object' THEN
      DECLARE
        raw_obj jsonb := r.raw_payload -> 'data' -> 'object';
        clean_obj jsonb;
      BEGIN
        clean_obj := jsonb_build_object(
          'id',                   raw_obj -> 'id',
          'amount',               raw_obj -> 'amount',
          'amount_received',      raw_obj -> 'amount_received',
          'amount_capturable',    raw_obj -> 'amount_capturable',
          'currency',             raw_obj -> 'currency',
          'status',               raw_obj -> 'status',
          'payment_method_types', raw_obj -> 'payment_method_types',
          'metadata',             raw_obj -> 'metadata'
        );

        -- Remove any null-valued keys from clean_obj (fields absent in source).
        clean_obj := jsonb_strip_nulls(clean_obj);

        -- Rebuild charges array, keeping only financial fields per charge.
        IF raw_obj ? 'charges' AND raw_obj -> 'charges' ? 'data' THEN
          clean_charges := '[]'::jsonb;
          FOR i IN 0 .. jsonb_array_length(raw_obj -> 'charges' -> 'data') - 1
          LOOP
            DECLARE
              ch jsonb := (raw_obj -> 'charges' -> 'data') -> i;
            BEGIN
              clean_charge := jsonb_strip_nulls(jsonb_build_object(
                'id',       ch -> 'id',
                'amount',   ch -> 'amount',
                'currency', ch -> 'currency',
                'status',   ch -> 'status',
                'paid',     ch -> 'paid',
                'refunded', ch -> 'refunded',
                'captured', ch -> 'captured',
                'metadata', ch -> 'metadata'
                -- billing_details, source, receipt_email intentionally omitted
              ));
              clean_charges := clean_charges || jsonb_build_array(clean_charge);
            END;
          END LOOP;
          clean_obj := clean_obj || jsonb_build_object(
            'charges', jsonb_build_object('data', clean_charges)
          );
        END IF;

        obj := obj || jsonb_build_object('data', jsonb_build_object('object', clean_obj));
      END;
    END IF;

    -- Add a retention audit marker so we know the payload was minimized.
    obj := obj || jsonb_build_object('_pii_minimized', true);

    UPDATE public.payment_events
    SET
      raw_payload  = obj,
      minimized_at = now()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. purge_payment_events()
--    Hard-deletes rows older than 730 days.
--    Returns number of rows deleted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_payment_events()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM public.payment_events
  WHERE received_at < now() - interval '730 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grant EXECUTE only to service_role. Never to authenticated / anon.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.minimize_payment_events() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_payment_events()    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.minimize_payment_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_payment_events()    TO service_role;

-- ---------------------------------------------------------------------------
-- 5. pg_cron schedules
--    Named so they can be unscheduled individually for rollback.
-- ---------------------------------------------------------------------------

-- Remove existing schedules if re-running this migration idempotently.
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('minimize-payment-events', 'purge-payment-events');

-- Daily at 03:15 UTC — minimize rows older than 7 days.
SELECT cron.schedule(
  'minimize-payment-events',
  '15 3 * * *',
  $cron$SELECT public.minimize_payment_events();$cron$
);

-- Monthly on the 1st at 03:30 UTC — hard-delete rows older than 730 days.
SELECT cron.schedule(
  'purge-payment-events',
  '30 3 1 * *',
  $cron$SELECT public.purge_payment_events();$cron$
);
