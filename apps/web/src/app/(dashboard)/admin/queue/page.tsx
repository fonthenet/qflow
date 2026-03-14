import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { QueueClient } from './queue-client';
import { getDefaultTerminology, type IndustryTerminology } from '@/lib/data/industry-templates';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string; status?: string; date?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Get staff with full details
  const { data: staff } = await supabase
    .from('staff')
    .select('id, organization_id, office_id, full_name, organization:organizations(name, business_type, settings)')
    .eq('auth_user_id', user.id)
    .single();
  if (!staff) redirect('/login');

  const orgId = staff.organization_id;
  const organization = Array.isArray(staff.organization) ? staff.organization[0] : staff.organization;
  const orgSettings = (organization?.settings as Record<string, unknown>) || null;
  const terminology = (orgSettings?.terminology as IndustryTerminology) || getDefaultTerminology();

  // Fetch offices for filter
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name');

  const officeIds = (offices || []).map((o) => o.id);

  const today = new Date().toISOString().split('T')[0];
  const [{ count: waitingCount }, { count: calledCount }, { count: servingCount }, { count: todayAppointments }] = await Promise.all([
    supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).in('status', ['waiting', 'issued']),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'called'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).in('office_id', officeIds).eq('status', 'serving'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('office_id', officeIds)
      .gte('scheduled_at', `${today}T00:00:00`)
      .lte('scheduled_at', `${today}T23:59:59`),
  ]);

  // Find desk currently assigned to this staff member
  const { data: assignedDesk } = await supabase
    .from('desks')
    .select('id, name, display_name, department_id, office_id')
    .eq('current_staff_id', staff.id)
    .eq('is_active', true)
    .single();

  // Fetch available desks (unassigned) for this staff's office
  const { data: availableDesks } = await supabase
    .from('desks')
    .select('id, name, display_name, department_id, office_id')
    .eq('office_id', staff.office_id || officeIds[0] || '')
    .eq('is_active', true)
    .is('current_staff_id', null)
    .order('name');

  // Fetch departments and services for transfer
  const primaryOfficeId = assignedDesk?.office_id || staff.office_id || officeIds[0] || '';
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name')
    .eq('office_id', primaryOfficeId)
    .eq('is_active', true)
    .order('name');

  const { data: services } = await supabase
    .from('services')
    .select('id, name, department_id')
    .eq('is_active', true)
    .order('name');

  // Build tickets query for history tab
  const pageSize = 50;
  const currentPage = parseInt(params.page || '1');
  const offset = (currentPage - 1) * pageSize;

  let ticketQuery = supabase
    .from('tickets')
    .select(
      'id, ticket_number, status, created_at, called_at, serving_started_at, completed_at, is_remote, customer_data, estimated_wait_minutes, qr_token, recall_count, priority, desk_id, office_id, department_id, service_id, service:services(name), department:departments(name), office:offices(name), desk:desks(name)',
      { count: 'exact' }
    )
    .in('office_id', officeIds)
    .order('created_at', { ascending: false });

  if (params.office) {
    ticketQuery = ticketQuery.eq('office_id', params.office);
  }
  if (params.status && params.status !== 'all') {
    ticketQuery = ticketQuery.eq('status', params.status);
  }
  if (params.date) {
    const start = new Date(params.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(params.date);
    end.setHours(23, 59, 59, 999);
    ticketQuery = ticketQuery
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());
  }

  ticketQuery = ticketQuery.range(offset, offset + pageSize - 1);
  const { data: tickets, count } = await ticketQuery;

  // Normalize Supabase join arrays
  const normalizedTickets = (tickets || []).map((t: Record<string, unknown>) => ({
    ...t,
    service: Array.isArray(t.service) ? t.service[0] || null : t.service,
    department: Array.isArray(t.department) ? t.department[0] || null : t.department,
    office: Array.isArray(t.office) ? t.office[0] || null : t.office,
    desk: Array.isArray(t.desk) ? t.desk[0] || null : t.desk,
  }));

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#173740_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Command center</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Run today&apos;s {terminology.customerPlural.toLowerCase()}, wait states, and handoffs from one place.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              Use this command center to keep arrivals, live service, and scheduled volume aligned.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Waiting now', value: waitingCount || 0 },
              { label: 'Called', value: calledCount || 0 },
              { label: 'Serving', value: servingCount || 0 },
              { label: 'Appointments today', value: todayAppointments || 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <QueueClient
        staffId={staff.id}
        staffName={staff.full_name}
        assignedDesk={assignedDesk || null}
        availableDesks={(availableDesks || []) as any}
        departments={(departments || []) as any}
        services={(services || []) as any}
        offices={(offices || []) as any}
        primaryOfficeId={primaryOfficeId}
        tickets={normalizedTickets as any}
        totalCount={count || 0}
        currentPage={currentPage}
        pageSize={pageSize}
        filters={{
          office: params.office || '',
          status: params.status || 'all',
          date: params.date || '',
        }}
      />
    </div>
  );
}
