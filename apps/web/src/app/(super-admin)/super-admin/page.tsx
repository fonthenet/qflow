import { requireSuperAdmin } from '@/lib/super-admin';
import { SuperAdminOverview } from '@/components/super-admin/overview';

export default async function SuperAdminPage() {
  const { admin } = await requireSuperAdmin();

  const [
    { data: organizations },
    { data: allStaff },
    { data: allOffices },
    { data: allLicenses },
    { data: allTickets },
    { data: pendingDevices },
  ] = await Promise.all([
    admin.from('organizations').select('id, name, slug, plan_id, subscription_status, created_at').order('created_at', { ascending: false }),
    admin.from('staff').select('id, organization_id, role, is_active'),
    admin.from('offices').select('id, organization_id, is_active'),
    admin.from('station_licenses').select('id, status, machine_id, machine_name, organization_name, license_key, activated_at'),
    admin.from('tickets').select('id, office_id, created_at').order('created_at', { ascending: false }).limit(10000),
    admin.from('pending_device_activations').select('id').eq('status', 'pending'),
  ]);

  const officeOrgMap: Record<string, string> = {};
  (allOffices ?? []).forEach((o: any) => { officeOrgMap[o.id] = o.organization_id; });

  const todayStr = new Date().toISOString().slice(0, 10);

  const orgSummaries = (organizations ?? []).map((org: any) => {
    const staff = (allStaff ?? []).filter((s: any) => s.organization_id === org.id);
    const offices = (allOffices ?? []).filter((o: any) => o.organization_id === org.id);
    const orgOfficeIds = new Set(offices.map((o: any) => o.id));
    const tickets = (allTickets ?? []).filter((t: any) => orgOfficeIds.has(t.office_id));
    const todayTickets = tickets.filter((t: any) => t.created_at?.startsWith(todayStr));
    return {
      ...org,
      staffCount: staff.filter((s: any) => s.is_active).length,
      officeCount: offices.filter((o: any) => o.is_active).length,
      todayTickets: todayTickets.length,
      totalTickets: tickets.length,
    };
  });

  const stats = {
    totalOrganizations: (organizations ?? []).length,
    totalStaff: (allStaff ?? []).filter((s: any) => s.is_active).length,
    totalOffices: (allOffices ?? []).filter((o: any) => o.is_active).length,
    totalLicenses: (allLicenses ?? []).length,
    activeLicenses: (allLicenses ?? []).filter((l: any) => l.status === 'active').length,
    boundDevices: (allLicenses ?? []).filter((l: any) => l.machine_id).length,
    pendingDevices: (pendingDevices ?? []).length,
    ticketsToday: (allTickets ?? []).filter((t: any) => t.created_at?.startsWith(todayStr)).length,
  };

  const recentDevices = (allLicenses ?? [])
    .filter((l: any) => l.machine_id)
    .slice(0, 6);

  return (
    <SuperAdminOverview
      stats={stats}
      organizations={orgSummaries}
      recentDevices={recentDevices}
    />
  );
}
