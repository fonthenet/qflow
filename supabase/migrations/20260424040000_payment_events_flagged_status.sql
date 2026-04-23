-- Migration: payment_events_flagged_status
-- Adds 'flagged' to the payment_events.status CHECK constraint.
--
-- 'flagged' is written when the webhook router detects a mismatch between
-- event.metadata.organization_id and the org resolved via stripe_customer_id.
-- These rows land in a dead-letter queue for manual review.
--
-- Safe to run multiple times (DROP + ADD pattern re-creates the constraint).

ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_status_check;

ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_status_check
  CHECK (status IN ('pending', 'processed', 'failed', 'flagged'));
