-- Migration: Idempotent onboarding via external_idempotency_key
-- Purpose: Allow offline Station signups to retry POST /api/onboarding/create-business
-- safely without creating duplicate organizations. The Station sends the key as an
-- Idempotency-Key HTTP header; the server stores it here and returns the existing
-- org on replay instead of creating a new one.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS external_idempotency_key TEXT;

-- Unique constraint so duplicate keys always resolve to the same org row
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_idempotency_key
  ON organizations (external_idempotency_key)
  WHERE external_idempotency_key IS NOT NULL;
