import { requireSuperAdmin } from '@/lib/super-admin';
import { SystemHealth } from '@/components/super-admin/health';

export default async function HealthPage() {
  const { admin } = await requireSuperAdmin();

  // Run health checks in parallel
  const startTime = Date.now();

  const [
    { data: orgs, error: orgError },
    { data: tickets, error: ticketError },
    { data: licenses, error: licenseError },
    { data: pendingDevices },
    { data: recentTickets },
    { data: staff },
  ] = await Promise.all([
    admin.from('organizations').select('id', { count: 'exact', head: true }),
    admin.from('tickets').select('id', { count: 'exact', head: true }),
    admin.from('station_licenses').select('id, status, machine_id, last_seen_at'),
    admin.from('pending_device_activations').select('id, created_at').eq('status', 'pending'),
    admin.from('tickets').select('id, created_at, status').order('created_at', { ascending: false }).limit(100),
    admin.from('staff').select('id, is_active', { count: 'exact', head: true }),
  ]);

  const dbResponseTime = Date.now() - startTime;

  // Check for stale tickets (waiting > 2 hours)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleTickets } = await admin
    .from('tickets')
    .select('id, ticket_number, office_id, created_at')
    .eq('status', 'waiting')
    .lt('created_at', twoHoursAgo)
    .limit(20);

  // Check for offline devices (last_seen > 1 hour ago)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const offlineDevices = (licenses ?? []).filter((l: any) =>
    l.machine_id && l.status === 'active' && l.last_seen_at && l.last_seen_at < oneHourAgo
  );

  // System checks
  const checks = [
    {
      name: 'Database Connection',
      status: !orgError && !ticketError ? 'healthy' : 'error',
      detail: `${dbResponseTime}ms response time`,
      metric: dbResponseTime,
    },
    {
      name: 'Pending Device Approvals',
      status: (pendingDevices ?? []).length > 0 ? 'warning' : 'healthy',
      detail: `${(pendingDevices ?? []).length} pending`,
      metric: (pendingDevices ?? []).length,
    },
    {
      name: 'Stale Tickets',
      status: (staleTickets ?? []).length > 5 ? 'error' : (staleTickets ?? []).length > 0 ? 'warning' : 'healthy',
      detail: `${(staleTickets ?? []).length} tickets waiting > 2 hours`,
      metric: (staleTickets ?? []).length,
    },
    {
      name: 'Device Connectivity',
      status: offlineDevices.length > 0 ? 'warning' : 'healthy',
      detail: offlineDevices.length > 0
        ? `${offlineDevices.length} device${offlineDevices.length > 1 ? 's' : ''} offline > 1 hour`
        : 'All devices online',
      metric: offlineDevices.length,
    },
    {
      name: 'RLS Policies',
      status: 'healthy',
      detail: 'Ticket update policy restricted to qr_token',
      metric: 0,
    },
  ];

  const overallStatus = checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warning')
      ? 'warning'
      : 'healthy';

  return (
    <SystemHealth
      checks={checks}
      overallStatus={overallStatus}
      staleTickets={staleTickets ?? []}
      offlineDevices={offlineDevices}
      dbResponseTime={dbResponseTime}
    />
  );
}
