import { createClient } from '@/lib/supabase/server';
import { PlatformDashboardClient } from './dashboard-client';

export default async function PlatformDashboardPage() {
  const supabase = await createClient();

  // Fetch all organizations with counts
  const { data: organizations } = await supabase
    .from('organizations')
    .select('id, name, slug, plan_id, subscription_status, created_at, monthly_visit_count')
    .order('created_at', { ascending: false });

  // Fetch total staff count
  const { count: staffCount } = await supabase
    .from('staff')
    .select('id', { count: 'exact', head: true });

  // Fetch total offices count
  const { count: officeCount } = await supabase
    .from('offices')
    .select('id', { count: 'exact', head: true });

  // Fetch today's tickets
  const today = new Date().toISOString().split('T')[0];
  const { count: todayTickets } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00`)
    .lte('created_at', `${today}T23:59:59`);

  // Fetch total tickets
  const { count: totalTickets } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true });

  // Recent tickets for activity feed
  const { data: recentTickets } = await supabase
    .from('tickets')
    .select('id, ticket_number, status, customer_name, created_at, service:services(name), office:offices(name)')
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <PlatformDashboardClient
      stats={{
        totalOrgs: organizations?.length || 0,
        totalStaff: staffCount || 0,
        totalOffices: officeCount || 0,
        todayTickets: todayTickets || 0,
        totalTickets: totalTickets || 0,
      }}
      organizations={organizations || []}
      recentTickets={recentTickets || []}
    />
  );
}
