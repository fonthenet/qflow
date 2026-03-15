import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, BellRing, Crown, MapPin, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type JoinedName = { name: string } | { name: string }[] | null;
type ActiveConciergeTicket = {
  id: string;
  ticket_number: string;
  status: string;
  created_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  priority: number | null;
  customer_data: Record<string, unknown> | null;
  service: { name: string } | null;
  department: { name: string } | null;
  desk: { name?: string | null; display_name?: string | null } | null;
};
type ConciergeArrival = {
  id: string;
  customer_name: string;
  scheduled_at: string;
  status: string | null;
  service: { name: string } | null;
  department: { name: string } | null;
};

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function getCustomerName(value: Record<string, unknown> | null) {
  if (value && typeof value.name === 'string' && value.name.trim()) return value.name;
  return 'Walk-in guest';
}

function formatClock(value: string | null) {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(value: string | null) {
  if (!value) return '--';
  const diff = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (diff <= 0) return 'just arrived';
  if (diff < 60) return `${diff} min ago`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
}

export default async function ConciergePage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const params = await searchParams;
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

  const [activeTicketsResult, completedTodayResult, appointmentsResult] = await Promise.all([
    selectedOfficeId
      ? supabase
          .from('tickets')
          .select(
            'id, ticket_number, status, created_at, called_at, serving_started_at, priority, customer_data, service:services(name), department:departments(name), desk:desks(name, display_name)'
          )
          .eq('office_id', selectedOfficeId)
          .in('status', ['issued', 'waiting', 'called', 'serving'])
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    selectedOfficeId
      ? supabase
          .from('tickets')
          .select('id, created_at, called_at, completed_at')
          .eq('office_id', selectedOfficeId)
          .not('completed_at', 'is', null)
          .gte('completed_at', `${today}T00:00:00`)
          .lte('completed_at', `${today}T23:59:59.999`)
      : Promise.resolve({ data: [] }),
    selectedOfficeId
      ? supabase
          .from('appointments')
          .select('id, customer_name, scheduled_at, status, service:services(name), department:departments(name)')
          .eq('office_id', selectedOfficeId)
          .neq('status', 'cancelled')
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59.999`)
          .order('scheduled_at')
      : Promise.resolve({ data: [] }),
  ]);

  const activeTickets: ActiveConciergeTicket[] = (activeTicketsResult.data || []).map((ticket: Record<string, unknown>) => ({
    id: String(ticket.id),
    ticket_number: String(ticket.ticket_number),
    status: String(ticket.status),
    created_at: (ticket.created_at as string | null) ?? null,
    called_at: (ticket.called_at as string | null) ?? null,
    serving_started_at: (ticket.serving_started_at as string | null) ?? null,
    priority: (ticket.priority as number | null) ?? null,
    customer_data: (ticket.customer_data as Record<string, unknown> | null) ?? null,
    service: normalizeJoin(ticket.service as JoinedName),
    department: normalizeJoin(ticket.department as JoinedName),
    desk: normalizeJoin(ticket.desk as { name?: string | null; display_name?: string | null } | { name?: string | null; display_name?: string | null }[] | null),
  }));

  const completedToday = completedTodayResult.data || [];
  const appointments: ConciergeArrival[] = (appointmentsResult.data || []).map((appointment: Record<string, unknown>) => ({
    id: String(appointment.id),
    customer_name: String(appointment.customer_name),
    scheduled_at: String(appointment.scheduled_at),
    status: (appointment.status as string | null) ?? null,
    service: normalizeJoin(appointment.service as JoinedName),
    department: normalizeJoin(appointment.department as JoinedName),
  }));

  const avgResponseMinutes = completedToday.length
    ? Math.round(
        completedToday.reduce((total, ticket) => {
          if (!ticket.created_at || !ticket.called_at) return total;
          return total + (new Date(ticket.called_at).getTime() - new Date(ticket.created_at).getTime()) / 60000;
        }, 0) / completedToday.length
      )
    : 0;

  const activeVip = activeTickets.filter((ticket) => Number(ticket.priority || 0) > 0).length;
  const upcomingConcierge = appointments.filter((appointment) => appointment.status !== 'checked_in').slice(0, 6);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#1a454e_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">High-touch flow</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Concierge requests, VIP arrivals, and live service handoffs now share one board.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              This board surfaces active high-touch visits plus booked arrivals that will need staff attention soon.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Active requests" value={activeTickets.length.toString()} helper="Issued, waiting, called, or serving" />
            <HeroStat label="VIP or elevated" value={activeVip.toString()} helper="Priority-backed guest flow" />
            <HeroStat label="Avg response" value={`${avgResponseMinutes}`} helper="Minutes from join to first call" suffix="m" />
            <HeroStat label="Completed today" value={completedToday.length.toString()} helper="Closed concierge interactions" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <form action="/admin/concierge" className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Office</span>
              <select
                name="office"
                defaultValue={selectedOfficeId}
                className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none"
              >
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Apply
            </button>
          </form>

          <Link href="/admin/queue" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]">
            Open command center
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Live service requests</h2>
            <p className="mt-1 text-sm leading-7 text-slate-500">
              Every active concierge interaction that still needs staff attention or completion.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {activeTickets.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
                No active concierge requests right now.
              </div>
            ) : (
              activeTickets.map((ticket: any) => (
                <article key={ticket.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {ticket.ticket_number}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${Number(ticket.priority || 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                          {Number(ticket.priority || 0) > 0 ? 'Elevated' : 'Standard'}
                        </span>
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                          {ticket.status}
                        </span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-slate-950">{getCustomerName(ticket.customer_data as Record<string, unknown> | null)}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {ticket.service?.name || 'General request'}
                        {ticket.department?.name ? ` · ${ticket.department.name}` : ''}
                      </p>
                    </div>

                    <div className="grid gap-2 text-right text-sm text-slate-500">
                      <span>{formatRelative(ticket.created_at as string | null)}</span>
                      <span>{ticket.desk?.display_name || ticket.desk?.name || 'No station assigned'}</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="space-y-6">
          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Upcoming booked arrivals</p>
            </div>
            <div className="mt-4 space-y-3">
              {upcomingConcierge.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">
                  No booked arrivals waiting for concierge attention today.
                </div>
              ) : (
                upcomingConcierge.map((appointment: any) => (
                  <div key={appointment.id} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{appointment.customer_name}</p>
                        <p className="text-sm text-slate-500">
                          {appointment.service?.name || 'Booked service'}
                          {appointment.department?.name ? ` · ${appointment.department.name}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">{formatClock(appointment.scheduled_at as string)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-[#446068]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">Concierge playbook</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                'Use priority-backed tickets to distinguish VIP or high-value requests from standard service flow.',
                'Booked arrivals appear here before check-in, then move into the command center once the guest arrives.',
                'Keep the live command center open for call, serve, recall, and transfer actions once a concierge request becomes active.',
              ].map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Response cues</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Issued / waiting', text: 'Request is logged but not yet called.' },
                { label: 'Called', text: 'Staff is ready and waiting for guest arrival.' },
                { label: 'Serving', text: 'Interaction is actively in progress.' },
              ].map((item) => (
                <div key={item.label} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.text}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, helper, suffix = '' }: { label: string; value: string; helper: string; suffix?: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}{suffix}</p>
      <p className="mt-1 text-sm text-white/65">{helper}</p>
    </div>
  );
}
