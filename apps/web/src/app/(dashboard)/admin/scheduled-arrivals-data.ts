import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type JoinedName = { name: string } | { name: string }[] | null;
type JoinedService =
  | { name: string; estimated_service_time?: number | null }
  | { name: string; estimated_service_time?: number | null }[]
  | null;
type JoinedDesk =
  | { name?: string | null; display_name?: string | null }
  | { name?: string | null; display_name?: string | null }[]
  | null;

export interface ScheduledArrival {
  id: string;
  office_id: string;
  department_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  status: string | null;
  ticket_id: string | null;
  created_at: string | null;
  office: { name: string } | null;
  department: { name: string } | null;
  service: { name: string; estimated_service_time?: number | null } | null;
  linkedTicket: {
    id: string;
    ticket_number: string;
    status: string;
    called_at: string | null;
    serving_started_at: string | null;
    completed_at: string | null;
    desk: { name?: string | null; display_name?: string | null } | null;
  } | null;
}

export interface ScheduledArrivalsPageData {
  organizationName: string;
  businessType: string | null;
  staffName: string;
  selectedOfficeId: string;
  selectedDate: string;
  offices: { id: string; name: string }[];
  departments: { id: string; name: string; office_id: string }[];
  services: {
    id: string;
    name: string;
    department_id: string;
    estimated_service_time: number | null;
  }[];
  arrivals: ScheduledArrival[];
  summary: {
    scheduledCount: number;
    checkedInCount: number;
    dueSoonCount: number;
    activeFlowCount: number;
    sevenDayVolume: number;
    cancellationRate: number;
  };
}

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function formatDateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

export async function getScheduledArrivalsPageData(params: {
  office?: string;
  date?: string;
}): Promise<ScheduledArrivalsPageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, organization_id, office_id, organization:organizations(name, business_type, settings, onboarding_completed)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) {
    redirect('/login');
  }

  const organization = Array.isArray(staff.organization)
    ? staff.organization[0] || null
    : staff.organization;

  const { data: officesData } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', staff.organization_id)
    .order('name');
  const offices = officesData || [];

  const officeIds = offices.map((office) => office.id);
  const selectedOfficeId = params.office || staff.office_id || offices[0]?.id || '';
  const selectedDate = params.date || formatDateKey(new Date());

  if (!organization?.onboarding_completed) {
    redirect('/setup');
  }

  if (officeIds.length === 0 || !selectedOfficeId) {
    return {
      organizationName: organization?.name || 'QueueFlow',
      businessType: organization?.business_type || null,
      staffName: staff.full_name,
      selectedOfficeId,
      selectedDate,
      offices,
      departments: [],
      services: [],
      arrivals: [],
      summary: {
        scheduledCount: 0,
        checkedInCount: 0,
        dueSoonCount: 0,
        activeFlowCount: 0,
        sevenDayVolume: 0,
        cancellationRate: 0,
      },
    };
  }

  const { data: departmentsData } = await supabase
    .from('departments')
    .select('id, name, office_id')
    .in('office_id', officeIds)
    .eq('is_active', true)
    .order('name');
  const departments = departmentsData || [];

  const departmentIds = departments.map((department) => department.id);
  const servicesResult = departmentIds.length
    ? await supabase
        .from('services')
        .select('id, name, department_id, estimated_service_time')
        .in('department_id', departmentIds)
        .eq('is_active', true)
        .order('name')
    : { data: [] as ScheduledArrivalsPageData['services'] };
  const services = servicesResult.data || [];

  const startOfDay = `${selectedDate}T00:00:00`;
  const endOfDay = `${selectedDate}T23:59:59.999`;
  const windowEnd = new Date(`${selectedDate}T00:00:00`);
  windowEnd.setDate(windowEnd.getDate() + 6);
  const sevenDayEnd = `${formatDateKey(windowEnd)}T23:59:59.999`;

  const cancellationWindowStart = new Date();
  cancellationWindowStart.setDate(cancellationWindowStart.getDate() - 13);
  const cancellationWindowStartIso = `${formatDateKey(cancellationWindowStart)}T00:00:00`;

  const [
    appointmentsResult,
    scheduledCountResult,
    checkedInCountResult,
    sevenDayVolumeResult,
    trailingAppointmentsResult,
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        'id, office_id, department_id, service_id, customer_name, customer_phone, customer_email, scheduled_at, status, ticket_id, created_at, office:offices(name), department:departments(name), service:services(name, estimated_service_time)'
      )
      .eq('office_id', selectedOfficeId)
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', endOfDay)
      .order('scheduled_at'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('office_id', selectedOfficeId)
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', endOfDay),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('office_id', selectedOfficeId)
      .eq('status', 'checked_in')
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', endOfDay),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('office_id', selectedOfficeId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', startOfDay)
      .lte('scheduled_at', sevenDayEnd),
    supabase
      .from('appointments')
      .select('status')
      .eq('office_id', selectedOfficeId)
      .gte('scheduled_at', cancellationWindowStartIso),
  ]);

  const appointmentsRaw = appointmentsResult.data || [];
  const appointmentIds = appointmentsRaw.map((appointment) => appointment.id);
  const linkedTicketsResult = appointmentIds.length
    ? await supabase
        .from('tickets')
        .select(
          'id, appointment_id, ticket_number, status, called_at, serving_started_at, completed_at, desk:desks(name, display_name)'
        )
        .in('appointment_id', appointmentIds)
    : { data: [] as Array<Record<string, unknown>> };
  const linkedTickets = linkedTicketsResult.data || [];

  const ticketsByAppointmentId = new Map(
    linkedTickets.map((ticket) => [
      String(ticket.appointment_id),
      {
        id: String(ticket.id),
        ticket_number: String(ticket.ticket_number),
        status: String(ticket.status),
        called_at: (ticket.called_at as string | null) ?? null,
        serving_started_at: (ticket.serving_started_at as string | null) ?? null,
        completed_at: (ticket.completed_at as string | null) ?? null,
        desk: normalizeJoin(ticket.desk as JoinedDesk),
      },
    ])
  );

  const arrivals = appointmentsRaw.map((appointment) => ({
    id: appointment.id,
    office_id: appointment.office_id,
    department_id: appointment.department_id,
    service_id: appointment.service_id,
    customer_name: appointment.customer_name,
    customer_phone: appointment.customer_phone,
    customer_email: appointment.customer_email,
    scheduled_at: appointment.scheduled_at,
    status: appointment.status,
    ticket_id: appointment.ticket_id,
    created_at: appointment.created_at,
    office: normalizeJoin(appointment.office as JoinedName),
    department: normalizeJoin(appointment.department as JoinedName),
    service: normalizeJoin(appointment.service as JoinedService),
    linkedTicket: ticketsByAppointmentId.get(appointment.id) || null,
  }));

  const activeFlowStatuses = new Set(['issued', 'waiting', 'called', 'serving']);
  const now = Date.now();
  const todayKey = formatDateKey(new Date());
  const dueSoonCount = arrivals.filter((arrival) => {
    const status = arrival.status || 'pending';
    const ticketStatus = arrival.linkedTicket?.status;
    if (status === 'cancelled' || status === 'checked_in') return false;
    if (ticketStatus && activeFlowStatuses.has(ticketStatus)) return false;
    if (selectedDate !== todayKey) return false;
    const minutesAway = (new Date(arrival.scheduled_at).getTime() - now) / 60000;
    return minutesAway >= -30 && minutesAway <= 90;
  }).length;

  const activeFlowCount = arrivals.filter((arrival) => {
    if (arrival.status === 'checked_in') return true;
    return arrival.linkedTicket ? activeFlowStatuses.has(arrival.linkedTicket.status) : false;
  }).length;

  const trailingAppointments = trailingAppointmentsResult.data || [];
  const trailingCancelled = trailingAppointments.filter(
    (appointment) => appointment.status === 'cancelled'
  ).length;
  const cancellationRate = trailingAppointments.length
    ? Math.round((trailingCancelled / trailingAppointments.length) * 100)
    : 0;

  return {
    organizationName: organization?.name || 'QueueFlow',
    businessType: organization?.business_type || null,
    staffName: staff.full_name,
    selectedOfficeId,
    selectedDate,
    offices,
    departments,
    services,
    arrivals,
    summary: {
      scheduledCount: scheduledCountResult.count || 0,
      checkedInCount: checkedInCountResult.count || 0,
      dueSoonCount,
      activeFlowCount,
      sevenDayVolume: sevenDayVolumeResult.count || 0,
      cancellationRate,
    },
  };
}
