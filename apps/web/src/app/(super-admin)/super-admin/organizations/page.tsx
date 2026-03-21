import { requireSuperAdmin } from '@/lib/super-admin';
import { OrganizationsManager } from '@/components/super-admin/organizations';

export default async function OrganizationsPage() {
  const { admin } = await requireSuperAdmin();

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
    admin.from('tickets').select('id, office_id, created_at').order('created_at', { ascending: false }).limit(10000),
  ]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const orgStats = (organizations ?? []).map((org: any) => {
    const staff = (allStaff ?? []).filter((s: any) => s.organization_id === org.id);
    const offices = (allOffices ?? []).filter((o: any) => o.organization_id === org.id);
    const licenses = (allLicenses ?? []).filter((l: any) => l.organization_id === org.id);
    const orgOfficeIds = new Set(offices.map((o: any) => o.id));
    const tickets = (allTickets ?? []).filter((t: any) => orgOfficeIds.has(t.office_id));

    return {
      ...org,
      staffCount: staff.length,
      activeStaff: staff.filter((s: any) => s.is_active).length,
      officeCount: offices.length,
      activeOffices: offices.filter((o: any) => o.is_active).length,
      licenseCount: licenses.length,
      activeLicenses: licenses.filter((l: any) => l.status === 'active').length,
      totalTickets: tickets.length,
      todayTickets: tickets.filter((t: any) => t.created_at?.startsWith(todayStr)).length,
      admins: staff.filter((s: any) => s.role === 'admin').map((s: any) => ({ name: s.full_name, email: s.email })),
    };
  });

  return <OrganizationsManager organizations={orgStats} licenses={allLicenses ?? []} />;
}
