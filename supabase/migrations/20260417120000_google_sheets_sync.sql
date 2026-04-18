-- Google Sheets sync: hygiene migration + auto-sync error tracking + pg_cron job.
--
-- The `google_connections` and `sheet_links` tables already exist in production
-- but have no migration file — so we use `CREATE TABLE IF NOT EXISTS` and
-- `ADD COLUMN IF NOT EXISTS` to stay idempotent for existing installs, and to
-- create them from scratch for any new environment.

-- ── google_connections ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  token_expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_connections_org_unique
  ON public.google_connections (organization_id);

-- ── sheet_links ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sheet_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sheet_id text NOT NULL,
  sheet_name text,
  sheet_url text,
  last_pushed_at timestamptz,
  last_row_count integer DEFAULT 0,
  auto_sync boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sheet_links_org_unique
  ON public.sheet_links (organization_id);

-- Error tracking (NEW)
ALTER TABLE public.sheet_links
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;

-- Index that drives the auto-sync cron: only rows with auto_sync=true and a
-- last_pushed_at older than the window need to be considered.
CREATE INDEX IF NOT EXISTS sheet_links_auto_sync_idx
  ON public.sheet_links (auto_sync, last_pushed_at)
  WHERE auto_sync = true;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Both tables are admin-only (service-role access from API routes + edge
-- functions). No public read/write.
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_links ENABLE ROW LEVEL SECURITY;

-- ── pg_cron auto-sync job ───────────────────────────────────────────────────
-- Every 15 minutes, invoke the `google-sheets-sync` edge function, which
-- iterates every org with auto_sync=true and a stale last_pushed_at.
--
-- Relies on the vault secret `service_role_key` (already used by other crons
-- in this project) and `project_url` for the function endpoint.
DO $$
DECLARE
  v_service_role_key text;
  v_project_url text;
BEGIN
  -- Fetch secrets from vault (safe: DO block is not logged with parameter values)
  BEGIN
    SELECT decrypted_secret INTO v_service_role_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    SELECT decrypted_secret INTO v_project_url
      FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Vault secrets not available — skipping cron job creation. Run cron.schedule manually.';
    RETURN;
  END;

  IF v_service_role_key IS NULL OR v_project_url IS NULL THEN
    RAISE NOTICE 'Vault secrets not set — skipping cron job creation.';
    RETURN;
  END IF;

  -- Remove any existing version of this job
  PERFORM cron.unschedule('google-sheets-auto-sync')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-sheets-auto-sync');

  PERFORM cron.schedule(
    'google-sheets-auto-sync',
    '*/15 * * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
      $cmd$,
      v_project_url || '/functions/v1/google-sheets-sync',
      v_service_role_key
    )
  );
END $$;
