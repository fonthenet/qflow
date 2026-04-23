-- Migration: DZ is cash-only at launch
-- Payment providers for Algeria are cleared; electronic rails (CIB/Edahabia/SATIM/Stripe)
-- are not offered to DZ orgs. Provider stubs remain registered in the codebase for
-- future activation when DZ opens to electronic payments.

UPDATE country_config
SET
  payment_providers = ARRAY[]::text[],
  feature_flags = feature_flags || '{"cash_only": true}'::jsonb
WHERE code = 'DZ';
