
-- Enable pg_net for async HTTP from Postgres
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Enable pg_cron for scheduled retries
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
;
