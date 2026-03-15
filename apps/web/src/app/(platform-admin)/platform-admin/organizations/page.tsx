import { createClient } from '@/lib/supabase/server';
import { OrganizationsClient } from './organizations-client';

export default async function OrganizationsPage() {
  const supabase = await createClient();

  const { data: organizations } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, plan_id, subscription_status, billing_period, trial_ends_at, current_period_end, monthly_visit_count, stripe_customer_id, created_at, updated_at')
    .order('created_at', { ascending: false });

  // Get staff counts per org
  const { data: staffCounts } = await supabase
    .from('staff')
    .select('organization_id');

  const staffByOrg: Record<string, number> = {};
  staffCounts?.forEach((s: any) => {
    staffByOrg[s.organization_id] = (staffByOrg[s.organization_id] || 0) + 1;
  });

  // Get office counts per org
  const { data: officeCounts } = await supabase
    .from('offices')
    .select('organization_id');

  const officesByOrg: Record<string, number> = {};
  officeCounts?.forEach((o: any) => {
    officesByOrg[o.organization_id] = (officesByOrg[o.organization_id] || 0) + 1;
  });

  const orgsWithCounts = (organizations || []).map((org: any) => ({
    ...org,
    staff_count: staffByOrg[org.id] || 0,
    office_count: officesByOrg[org.id] || 0,
  }));

  return <OrganizationsClient organizations={orgsWithCounts} />;
}
