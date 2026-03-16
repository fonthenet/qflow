
-- Add plan and billing fields to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT 'free'
    CHECK (plan_id IN ('free', 'starter', 'growth', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly', 'yearly')),
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS monthly_visit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visit_count_reset_at timestamptz NOT NULL DEFAULT date_trunc('month', now());

-- Create indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id ON public.organizations (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id ON public.organizations (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_organizations_plan_id ON public.organizations (plan_id);

-- Billing events log for audit trail
CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  stripe_event_id text UNIQUE,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org_id ON public.billing_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event_id ON public.billing_events (stripe_event_id);

-- RLS for billing_events
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_events_select_own_org" ON public.billing_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
    )
  );

-- Invoices table for local record keeping
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_invoice_id text UNIQUE,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON public.invoices (organization_id);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select_own_org" ON public.invoices
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
    )
  );

-- Function to reset monthly visit counts (run via cron)
CREATE OR REPLACE FUNCTION public.reset_monthly_visit_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.organizations
  SET monthly_visit_count = 0,
      visit_count_reset_at = now()
  WHERE visit_count_reset_at < date_trunc('month', now());
END;
$$;

-- Function to increment visit count when a ticket is created
CREATE OR REPLACE FUNCTION public.increment_org_visit_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_id uuid;
BEGIN
  SELECT o.organization_id INTO org_id
  FROM public.offices o
  WHERE o.id = NEW.office_id;

  UPDATE public.organizations
  SET monthly_visit_count = monthly_visit_count + 1
  WHERE id = org_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ticket_increment_visit_count ON public.tickets;
CREATE TRIGGER ticket_increment_visit_count
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.increment_org_visit_count();
;
