import { requireSuperAdmin } from '@/lib/super-admin';
import { PlatformAnalytics } from '@/components/super-admin/analytics';

export default async function AnalyticsPage() {
  const { admin } = await requireSuperAdmin();

  const [
    { data: organizations },
    { data: allOffices },
    { data: allTickets },
    { data: allStaff },
  ] = await Promise.all([
    admin.from('organizations').select('id, name').order('name'),
    admin.from('offices').select('id, organization_id'),
    admin.from('tickets').select('id, office_id, status, created_at').order('created_at', { ascending: false }).limit(50000),
    admin.from('staff').select('id, organization_id, is_active'),
  ]);

  const officeOrgMap: Record<string, string> = {};
  (allOffices ?? []).forEach((o: any) => { officeOrgMap[o.id] = o.organization_id; });

  // Tickets per org
  const orgTickets: Record<string, number> = {};
  const orgTodayTickets: Record<string, number> = {};
  const todayStr = new Date().toISOString().slice(0, 10);
  (allTickets ?? []).forEach((t: any) => {
    const orgId = officeOrgMap[t.office_id];
    if (orgId) {
      orgTickets[orgId] = (orgTickets[orgId] || 0) + 1;
      if (t.created_at?.startsWith(todayStr)) {
        orgTodayTickets[orgId] = (orgTodayTickets[orgId] || 0) + 1;
      }
    }
  });

  // Tickets per day (last 30 days)
  const dailyTickets: Record<string, number> = {};
  (allTickets ?? []).forEach((t: any) => {
    const day = t.created_at?.slice(0, 10);
    if (day) dailyTickets[day] = (dailyTickets[day] || 0) + 1;
  });

  const orgAnalytics = (organizations ?? []).map((org: any) => ({
    id: org.id,
    name: org.name,
    totalTickets: orgTickets[org.id] || 0,
    todayTickets: orgTodayTickets[org.id] || 0,
    staffCount: (allStaff ?? []).filter((s: any) => s.organization_id === org.id && s.is_active).length,
  })).sort((a: any, b: any) => b.totalTickets - a.totalTickets);

  // Last 30 days
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    days.push({ date: ds, count: dailyTickets[ds] || 0 });
  }

  return (
    <PlatformAnalytics
      orgAnalytics={orgAnalytics}
      dailyTickets={days}
      totalTickets={(allTickets ?? []).length}
      totalToday={Object.values(orgTodayTickets).reduce((a, b) => a + b, 0)}
    />
  );
}
