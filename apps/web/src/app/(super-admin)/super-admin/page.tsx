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
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

  const todayTicketsAll = (allTickets ?? []).filter((t: any) => t.created_at?.startsWith(todayStr));
  const weekTicketsAll = (allTickets ?? []).filter((t: any) => t.created_at?.slice(0, 10) >= weekAgo);
  const activeOrgsToday = new Set(
    todayTicketsAll.map((t: any) => officeOrgMap[t.office_id]).filter(Boolean)
  ).size;

  // Calculate avg tickets per day (last 7 days excluding today)
  const last7DaysTickets = (allTickets ?? []).filter((t: any) => {
    const d = t.created_at?.slice(0, 10);
    return d >= weekAgo && d < todayStr;
  });
  const avgTicketsPerDay = last7DaysTickets.length > 0 ? Math.round(last7DaysTickets.length / 7) : 0;

  const stats = {
    totalOrganizations: (organizations ?? []).length,
    totalStaff: (allStaff ?? []).filter((s: any) => s.is_active).length,
    totalOffices: (allOffices ?? []).filter((o: any) => o.is_active).length,
    totalLicenses: (allLicenses ?? []).length,
    activeLicenses: (allLicenses ?? []).filter((l: any) => l.status === 'active').length,
    boundDevices: (allLicenses ?? []).filter((l: any) => l.machine_id).length,
    pendingDevices: (pendingDevices ?? []).length,
    ticketsToday: todayTicketsAll.length,
    ticketsThisWeek: weekTicketsAll.length,
    avgTicketsPerDay,
    activeOrgsToday,
  };

  const recentDevices = (allLicenses ?? [])
    .filter((l: any) => l.machine_id)
    .slice(0, 6);

  // Build recent activity feed from various sources
  const recentActivity: { id: string; type: 'org_created' | 'license_activated' | 'device_approved' | 'ticket_milestone'; message: string; timestamp: string }[] = [];

  // Recent org creations (last 30 days)
  for (const org of (organizations ?? []).slice(0, 5)) {
    const created = new Date((org as any).created_at);
    if (Date.now() - created.getTime() < 30 * 24 * 60 * 60 * 1000) {
      recentActivity.push({
        id: `org-${(org as any).id}`,
        type: 'org_created',
        message: `${(org as any).name} registered on the platform`,
        timestamp: (org as any).created_at,
      });
    }
  }

  // Recent device activations
  for (const license of (allLicenses ?? []).filter((l: any) => l.activated_at)) {
    const activated = new Date((license as any).activated_at);
    if (Date.now() - activated.getTime() < 7 * 24 * 60 * 60 * 1000) {
      recentActivity.push({
        id: `license-${(license as any).id}`,
        type: 'license_activated',
        message: `Device ${(license as any).machine_name ?? (license as any).machine_id?.slice(0, 12)} activated for ${(license as any).organization_name ?? 'Unknown'}`,
        timestamp: (license as any).activated_at,
      });
    }
  }

  // Sort activity by timestamp desc and take top 8
  recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <SuperAdminOverview
      stats={stats}
      organizations={orgSummaries}
      recentDevices={recentDevices}
      recentActivity={recentActivity.slice(0, 8)}
    />
  );
}
