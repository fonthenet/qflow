-- Dead columns — superseded by settings.business_setup_wizard_completed_at
-- (see migration 20260424010000 & onboarding route).
-- Grepped across apps/web/src, apps/desktop/src, apps/desktop/electron,
-- supabase/functions, and all migrations: zero production reads or writes found.

ALTER TABLE organizations DROP COLUMN IF EXISTS onboarding_completed;
ALTER TABLE organizations DROP COLUMN IF EXISTS onboarding_step;
