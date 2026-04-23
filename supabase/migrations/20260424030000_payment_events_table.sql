-- Migration: payment_events_table
-- Creates a provider-agnostic audit table for all inbound payment webhook events.
--
-- Design decisions:
-- - (provider, provider_event_id) UNIQUE enforces idempotency at DB level.
--   Duplicate webhook deliveries (common with Stripe, Fawry, MTN etc.) are safe no-ops.
-- - organization_id is nullable because some webhook events arrive before
--   Qflo can associate them with an org (e.g. new checkout sessions).
-- - raw_payload stored for audit and replay; never returned to the client.
-- - status lifecycle: pending → processed | failed
-- - RLS: org members can SELECT their org's events; only service role can INSERT/UPDATE.

CREATE TABLE IF NOT EXISTS public.payment_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL,
  provider_event_id text        NOT NULL,
  organization_id   uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type        text        NOT NULL,
  amount            bigint,
  currency          text,
  metadata          jsonb,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processed', 'failed')),
  raw_payload       jsonb
);

-- Idempotency constraint
ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_provider_event_uniq;

ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_provider_event_uniq
  UNIQUE (provider, provider_event_id);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_payment_events_org
  ON public.payment_events (organization_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_status
  ON public.payment_events (status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider
  ON public.payment_events (provider, received_at DESC);

-- RLS
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Org members can view their org's events (read-only)
DROP POLICY IF EXISTS "payment_events_org_select" ON public.payment_events;
CREATE POLICY "payment_events_org_select"
  ON public.payment_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = get_my_org_id()
  );

-- Service role has full access (webhook handler runs with service role key)
-- (Service role bypasses RLS by default in Supabase — no explicit policy needed)
