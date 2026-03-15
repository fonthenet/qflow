import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { QueueClient } from './queue-client';

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
    .select('id, organization_id, office_id, full_name')
    .eq('auth_user_id', user.id)
    .single();
  if (!staff) redirect('/login');

  const orgId = staff.organization_id;

  // Fetch offices for filter
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', orgId)
    .order('name');

  const officeIds = (offices || []).map((o) => o.id);

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
  );
}
