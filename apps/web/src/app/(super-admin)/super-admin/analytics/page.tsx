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
    admin.from('tickets').select('id, office_id, status, created_at, serving_started_at, completed_at, called_at').order('created_at', { ascending: false }).limit(50000),
    admin.from('staff').select('id, organization_id, is_active'),
  ]);

  const officeOrgMap: Record<string, string> = {};
  (allOffices ?? []).forEach((o: any) => { officeOrgMap[o.id] = o.organization_id; });

  const todayStr = new Date().toISOString().slice(0, 10);

  // Tickets per org + per day
  const orgTickets: Record<string, number> = {};
  const orgTodayTickets: Record<string, number> = {};
  const dailyTickets: Record<string, number> = {};
  const hourlyTickets: Record<number, number> = {};

  let totalWaitMs = 0;
  let waitCount = 0;
  let totalServiceMs = 0;
  let serviceCount = 0;
  let noShowCount = 0;
  let totalCompleted = 0;

  // Per-org wait times
  const orgWaitTimes: Record<string, { total: number; count: number }> = {};

  (allTickets ?? []).forEach((t: any) => {
    const orgId = officeOrgMap[t.office_id];
    if (orgId) {
      orgTickets[orgId] = (orgTickets[orgId] || 0) + 1;
      if (t.created_at?.startsWith(todayStr)) {
        orgTodayTickets[orgId] = (orgTodayTickets[orgId] || 0) + 1;
      }
    }

    const day = t.created_at?.slice(0, 10);
    if (day) dailyTickets[day] = (dailyTickets[day] || 0) + 1;

    // Hourly distribution for today
    if (t.created_at?.startsWith(todayStr)) {
      const hour = new Date(t.created_at).getHours();
      hourlyTickets[hour] = (hourlyTickets[hour] || 0) + 1;
    }

    // Wait time: created_at → called_at or serving_started_at
    if (t.called_at && t.created_at) {
      const wait = new Date(t.called_at).getTime() - new Date(t.created_at).getTime();
      if (wait > 0 && wait < 24 * 60 * 60 * 1000) {
        totalWaitMs += wait;
        waitCount++;
        if (orgId) {
          if (!orgWaitTimes[orgId]) orgWaitTimes[orgId] = { total: 0, count: 0 };
          orgWaitTimes[orgId].total += wait;
          orgWaitTimes[orgId].count++;
        }
      }
    }

    // Service time: serving_started_at → completed_at
    if (t.serving_started_at && t.completed_at) {
      const service = new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime();
      if (service > 0 && service < 8 * 60 * 60 * 1000) {
        totalServiceMs += service;
        serviceCount++;
      }
    }

    // No-show tracking
    if (t.status === 'no_show') noShowCount++;
    if (['served', 'completed', 'no_show'].includes(t.status)) totalCompleted++;
  });

  const avgWaitTime = waitCount > 0 ? Math.round(totalWaitMs / waitCount / 60000) : 0;
  const avgServiceTime = serviceCount > 0 ? Math.round(totalServiceMs / serviceCount / 60000) : 0;
  const noShowRate = totalCompleted > 0 ? Math.round((noShowCount / totalCompleted) * 100) : 0;

  const orgAnalytics = (organizations ?? []).map((org: any) => ({
    id: org.id,
    name: org.name,
    totalTickets: orgTickets[org.id] || 0,
    todayTickets: orgTodayTickets[org.id] || 0,
    staffCount: (allStaff ?? []).filter((s: any) => s.organization_id === org.id && s.is_active).length,
    avgWaitTime: orgWaitTimes[org.id]
      ? Math.round(orgWaitTimes[org.id].total / orgWaitTimes[org.id].count / 60000)
      : 0,
    avgServiceTime: 0, // Would need per-org breakdown
  })).sort((a: any, b: any) => b.totalTickets - a.totalTickets);

  // Last 30 days
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    days.push({ date: ds, count: dailyTickets[ds] || 0 });
  }

  // Hourly distribution (6am - 10pm)
  const hourlyDistribution = [];
  for (let h = 6; h <= 22; h++) {
    hourlyDistribution.push({ hour: h, count: hourlyTickets[h] || 0 });
  }

  return (
    <PlatformAnalytics
      orgAnalytics={orgAnalytics}
      dailyTickets={days}
      hourlyDistribution={hourlyDistribution}
      totalTickets={(allTickets ?? []).length}
      totalToday={Object.values(orgTodayTickets).reduce((a, b) => a + b, 0)}
      avgWaitTime={avgWaitTime}
      avgServiceTime={avgServiceTime}
      noShowRate={noShowRate}
    />
  );
}
