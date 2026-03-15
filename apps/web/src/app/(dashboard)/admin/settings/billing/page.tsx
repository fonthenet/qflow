import { createClient } from '@/lib/supabase/server';
import { BillingClient } from './billing-client';

export default async function BillingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <div className="p-6 text-red-500">Not authenticated.</div>;
  }

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff || staff.role !== 'admin') {
    return <div className="p-6 text-red-500">Only admins can manage billing.</div>;
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, plan_id, subscription_status, billing_period, trial_ends_at, current_period_end, monthly_visit_count, stripe_customer_id')
    .eq('id', staff.organization_id)
    .single();

  if (!org) {
    return <div className="p-6 text-red-500">Organization not found.</div>;
  }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return <BillingClient org={org} invoices={invoices || []} />;
}
