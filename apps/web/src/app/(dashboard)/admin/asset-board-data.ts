import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type DeskRecord = {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string | null;
  status: string | null;
  is_active: boolean | null;
  current_staff_id: string | null;
  office: { name: string } | { name: string }[] | null;
  department: { name: string } | { name: string }[] | null;
  current_staff: { full_name: string } | { full_name: string }[] | null;
};

type TicketRecord = {
  id: string;
  ticket_number: string;
  status: string;
  created_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  desk_id: string | null;
  priority: number | null;
  customer_data: Record<string, unknown> | null;
  service: { name: string } | { name: string }[] | null;
};

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function getCustomerName(value: Record<string, unknown> | null) {
  if (value && typeof value.name === 'string' && value.name.trim()) return value.name;
  return 'Walk-in';
}

export async function getAssetBoardData(params: { office?: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, office_id, organization:organizations(name, business_type)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  const organization = Array.isArray(staff.organization) ? staff.organization[0] || null : staff.organization;

  const { data: officesData } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', staff.organization_id)
    .order('name');
  const offices = officesData || [];

  const selectedOfficeId = params.office || staff.office_id || offices[0]?.id || '';
  const today = new Date().toISOString().split('T')[0];

  const [desksResult, activeTicketsResult, appointmentsResult] = await Promise.all([
    selectedOfficeId
      ? supabase
          .from('desks')
          .select('id, name, display_name, office_id, department_id, status, is_active, current_staff_id, office:offices(name), department:departments(name), current_staff:staff(full_name)')
          .eq('office_id', selectedOfficeId)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    selectedOfficeId
      ? supabase
          .from('tickets')
          .select('id, ticket_number, status, created_at, called_at, serving_started_at, desk_id, priority, customer_data, service:services(name)')
          .eq('office_id', selectedOfficeId)
          .in('status', ['called', 'serving', 'waiting'])
      : Promise.resolve({ data: [] }),
    selectedOfficeId
      ? supabase
          .from('appointments')
          .select('id, scheduled_at, status')
          .eq('office_id', selectedOfficeId)
          .neq('status', 'cancelled')
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59.999`)
      : Promise.resolve({ data: [] }),
  ]);

  const desks = (desksResult.data || []).map((desk: DeskRecord) => ({
    ...desk,
    office: normalizeJoin(desk.office),
    department: normalizeJoin(desk.department),
    current_staff: normalizeJoin(desk.current_staff),
  }));

  const activeTickets = (activeTicketsResult.data || []).map((ticket: TicketRecord) => ({
    ...ticket,
    service: normalizeJoin(ticket.service),
  }));

  const appointments = appointmentsResult.data || [];
  const ticketsByDeskId = new Map(activeTickets.filter((ticket) => ticket.desk_id).map((ticket) => [ticket.desk_id as string, ticket]));

  const assets = desks.map((desk) => {
    const ticket = ticketsByDeskId.get(desk.id) || null;
    return {
      ...desk,
      ticket,
      customerName: ticket ? getCustomerName(ticket.customer_data as Record<string, unknown> | null) : null,
    };
  });

  const occupiedCount = assets.filter((asset) => asset.ticket && asset.ticket.status === 'serving').length;
  const calledCount = assets.filter((asset) => asset.ticket && asset.ticket.status === 'called').length;
  const waitingAssignmentCount = activeTickets.filter((ticket) => ticket.status === 'waiting' && !ticket.desk_id).length;
  const availableCount = Math.max(0, assets.length - occupiedCount - calledCount);
  const bookedCount = appointments.filter((appointment) => appointment.status !== 'checked_in').length;

  return {
    organizationName: organization?.name || 'QueueFlow',
    businessType: organization?.business_type || null,
    offices,
    selectedOfficeId,
    assets,
    summary: {
      totalAssets: assets.length,
      occupiedCount,
      calledCount,
      availableCount,
      waitingAssignmentCount,
      bookedCount,
    },
  };
}
