
-- API keys for REST API access
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON public.api_keys (organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys (key_hash);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_keys_select_own_org" ON public.api_keys
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "api_keys_insert_own_org" ON public.api_keys
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "api_keys_delete_own_org" ON public.api_keys
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

-- Webhook endpoints
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_id ON public.webhook_endpoints (organization_id);

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_endpoints_select_own_org" ON public.webhook_endpoints
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "webhook_endpoints_insert_own_org" ON public.webhook_endpoints
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "webhook_endpoints_update_own_org" ON public.webhook_endpoints
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "webhook_endpoints_delete_own_org" ON public.webhook_endpoints
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM public.staff
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_id ON public.webhook_deliveries (endpoint_id);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_deliveries_select_own_org" ON public.webhook_deliveries
  FOR SELECT USING (
    endpoint_id IN (
      SELECT id FROM public.webhook_endpoints
      WHERE organization_id IN (
        SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
      )
    )
  );
;
