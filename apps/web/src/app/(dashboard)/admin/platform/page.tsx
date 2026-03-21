import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PlatformDashboard } from './platform-dashboard';

const SUPER_ADMIN_EMAIL = 'f.onthenet@gmail.com';

export default async function PlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== SUPER_ADMIN_EMAIL) redirect('/admin/overview');

  // Use admin client (service role bypasses RLS) — cast to any for station_licenses which isn't in generated types yet
  const admin = createAdminClient() as any;

  // Fetch all organizations with their stats
  const [
    { data: organizations },
    { data: allStaff },
    { data: allOffices },
    { data: allLicenses },
    { data: allTickets },
  ] = await Promise.all([
    admin.from('organizations').select('id, name, slug, logo_url, plan_id, subscription_status, trial_ends_at, current_period_end, monthly_visit_count, settings, created_at').order('created_at', { ascending: false }),
    admin.from('staff').select('id, organization_id, role, is_active, full_name, email'),
    admin.from('offices').select('id, organization_id, name, is_active'),
    admin.from('station_licenses').select('*').order('created_at', { ascending: false }),
    admin.from('tickets').select('id, office_id, status, created_at').order('created_at', { ascending: false }).limit(10000),
  ]);

  // Map offices to orgs for ticket counting
  const officeOrgMap: Record<string, string> = {};
  (allOffices ?? []).forEach((o: any) => { officeOrgMap[o.id] = o.organization_id; });

  // Build org stats
  const orgStats = (organizations ?? []).map((org: any) => {
    const staff = (allStaff ?? []).filter((s: any) => s.organization_id === org.id);
    const offices = (allOffices ?? []).filter((o: any) => o.organization_id === org.id);
    const licenses = (allLicenses ?? []).filter((l: any) => l.organization_id === org.id);
    const orgOfficeIds = new Set(offices.map((o: any) => o.id));
    const tickets = (allTickets ?? []).filter((t: any) => orgOfficeIds.has(t.office_id));
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayTickets = tickets.filter((t: any) => t.created_at?.startsWith(todayStr));

    return {
      ...org,
      staffCount: staff.length,
      activeStaff: staff.filter((s: any) => s.is_active).length,
      officeCount: offices.length,
      activeOffices: offices.filter((o: any) => o.is_active).length,
      licenseCount: licenses.length,
      activeLicenses: licenses.filter((l: any) => l.status === 'active').length,
      totalTickets: tickets.length,
      todayTickets: todayTickets.length,
      admins: staff.filter((s: any) => s.role === 'admin').map((s: any) => ({ name: s.full_name, email: s.email })),
    };
  });

  // Platform-wide stats
  const platformStats = {
    totalOrganizations: (organizations ?? []).length,
    totalStaff: (allStaff ?? []).length,
    totalOffices: (allOffices ?? []).length,
    totalLicenses: (allLicenses ?? []).length,
    activeLicenses: (allLicenses ?? []).filter((l: any) => l.status === 'active').length,
    totalTicketsToday: (() => {
      const todayStr = new Date().toISOString().slice(0, 10);
      return (allTickets ?? []).filter((t: any) => t.created_at?.startsWith(todayStr)).length;
    })(),
  };

  return (
    <PlatformDashboard
      organizations={orgStats}
      licenses={allLicenses ?? []}
      platformStats={platformStats}
    />
  );
}
