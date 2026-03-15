import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, HeartPulse, Siren, Stethoscope } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type PriorityCategory = {
  id: string;
  name: string;
  color: string | null;
  weight: number | null;
  icon: string | null;
};

type TriageTicket = {
  id: string;
  ticket_number: string;
  status: string;
  created_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  customer_data: Record<string, unknown> | null;
  priority: number | null;
  priority_category_id: string | null;
  estimated_wait_minutes: number | null;
  service: { name: string } | { name: string }[] | null;
  department: { name: string } | { name: string }[] | null;
  office: { name: string } | { name: string }[] | null;
  desk: { name?: string | null; display_name?: string | null } | { name?: string | null; display_name?: string | null }[] | null;
};

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function getCustomerName(value: Record<string, unknown> | null) {
  if (value && typeof value.name === 'string' && value.name.trim()) return value.name;
  return 'Walk-in';
}

function formatClock(value: string | null) {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatElapsed(value: string | null) {
  if (!value) return '--';
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (diffMinutes < 1) return 'Just arrived';
  if (diffMinutes < 60) return `${diffMinutes} min waiting`;
  const hours = Math.floor(diffMinutes / 60);
  return `${hours}h ${diffMinutes % 60}m waiting`;
}

function getSeverity(weight: number) {
  if (weight >= 40) {
    return {
      label: 'Critical',
      tone: 'bg-rose-50 text-rose-700 border-rose-200',
      panel: 'border-rose-200 bg-[linear-gradient(180deg,_#fff6f7_0%,_#ffffff_100%)]',
    };
  }
  if (weight >= 25) {
    return {
      label: 'Urgent',
      tone: 'bg-amber-50 text-amber-700 border-amber-200',
      panel: 'border-amber-200 bg-[linear-gradient(180deg,_#fffaf0_0%,_#ffffff_100%)]',
    };
  }
  if (weight >= 10) {
    return {
      label: 'Priority',
      tone: 'bg-sky-50 text-sky-700 border-sky-200',
      panel: 'border-sky-200 bg-[linear-gradient(180deg,_#f5fbff_0%,_#ffffff_100%)]',
    };
  }
  return {
    label: 'Standard',
    tone: 'bg-slate-100 text-slate-600 border-slate-200',
    panel: 'border-slate-200 bg-[linear-gradient(180deg,_#fafaf9_0%,_#ffffff_100%)]',
  };
}

export default async function TriagePage({
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

  const officeIds = offices.map((office) => office.id);
  const selectedOfficeId = params.office || staff.office_id || offices[0]?.id || '';
  const filterOfficeIds = selectedOfficeId ? [selectedOfficeId] : officeIds;

  const [prioritiesResult, ticketsResult] = await Promise.all([
    supabase
      .from('priority_categories')
      .select('id, name, color, weight, icon')
      .eq('organization_id', staff.organization_id)
      .eq('is_active', true)
      .order('weight', { ascending: false }),
    filterOfficeIds.length
      ? supabase
          .from('tickets')
          .select(
            'id, ticket_number, status, created_at, called_at, serving_started_at, completed_at, customer_data, priority, priority_category_id, estimated_wait_minutes, service:services(name), department:departments(name), office:offices(name), desk:desks(name, display_name)'
          )
          .in('office_id', filterOfficeIds)
          .in('status', ['issued', 'waiting', 'called', 'serving'])
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as TriageTicket[] }),
  ]);

  const priorities = prioritiesResult.data || [];
  const tickets = ticketsResult.data || [];

  const prioritiesById = new Map(priorities.map((priority) => [priority.id, priority]));

  const normalizedTickets = (tickets as TriageTicket[]).map((ticket) => {
    const category = ticket.priority_category_id ? prioritiesById.get(ticket.priority_category_id) || null : null;
    const derivedWeight = category?.weight ?? ticket.priority ?? 0;

    return {
      ...ticket,
      service: normalizeJoin(ticket.service),
      department: normalizeJoin(ticket.department),
      office: normalizeJoin(ticket.office),
      desk: normalizeJoin(ticket.desk),
      category,
      derivedWeight,
    };
  });

  const critical = normalizedTickets.filter((ticket) => ticket.derivedWeight >= 40);
  const urgent = normalizedTickets.filter((ticket) => ticket.derivedWeight >= 25 && ticket.derivedWeight < 40);
  const priorityFlow = normalizedTickets.filter((ticket) => ticket.derivedWeight >= 10 && ticket.derivedWeight < 25);
  const standard = normalizedTickets.filter((ticket) => ticket.derivedWeight < 10);
  const calledOrServing = normalizedTickets.filter((ticket) => ticket.status === 'called' || ticket.status === 'serving');
  const longestWait = normalizedTickets.reduce((max, ticket) => {
    if (!ticket.created_at) return max;
    const wait = Math.max(0, Math.round((Date.now() - new Date(ticket.created_at).getTime()) / 60000));
    return Math.max(max, wait);
  }, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#301210_0%,_#4a1f1a_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(47,15,10,0.18)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ffc5b7]">Urgency routing</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Triage now sits on the live queue instead of a disconnected waiting-room list.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              Use this board to see every active priority visit, the configured urgency categories behind it, and the fastest path back into the command center.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Critical" value={critical.length} helper="Immediate attention lane" />
            <HeroStat label="Urgent" value={urgent.length} helper="High-priority pending care" />
            <HeroStat label="In motion" value={calledOrServing.length} helper="Already called or serving" />
            <HeroStat label="Longest wait" value={longestWait} helper="Minutes across active triage" suffix="m" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Priority categories" value={priorities.length.toString()} helper="Configured urgency rules" />
        <MetricCard label="Active triage board" value={normalizedTickets.length.toString()} helper="Issued, waiting, called, and serving" />
        <MetricCard label="Priority flow" value={priorityFlow.length.toString()} helper="Needs elevated handling" />
        <MetricCard label="Standard load" value={standard.length.toString()} helper="Non-urgent active visits" />
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Office</span>
              <select
                value={selectedOfficeId}
                onChange={() => {}}
                className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none"
                name="office"
                form="triage-filter"
              >
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </label>
            <form id="triage-filter" className="inline-flex items-center gap-2" action="/admin/triage">
              <button type="submit" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
                Apply
              </button>
            </form>
          </div>

          <Link href="/admin/queue" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#301210] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4a1f1a]">
            Open command center
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-6">
          <SeveritySection
            title="Critical now"
            description="Patients or visits with the highest configured urgency weight."
            tickets={critical}
          />
          <SeveritySection
            title="Urgent next"
            description="High-priority visits that should stay ahead of standard demand."
            tickets={urgent}
          />
          <SeveritySection
            title="Priority flow"
            description="Elevated but not immediate visits still active in the queue."
            tickets={priorityFlow}
          />
        </div>

        <div className="space-y-6">
          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <Siren className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Urgency categories</p>
            </div>
            <div className="mt-4 space-y-3">
              {priorities.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">
                  Configure priority categories in `/admin/priorities` to shape triage.
                </div>
              ) : (
                priorities.map((priority) => (
                  <div key={priority.id} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm text-white" style={{ backgroundColor: priority.color || '#6b7280' }}>
                          {priority.icon || '!'}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-900">{priority.name}</p>
                          <p className="text-xs text-slate-500">Weight {priority.weight ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#edd9d4] bg-[#fff6f3] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b4b40]">Triage guidance</p>
            <div className="mt-4 space-y-3">
              {[
                'Keep urgency rules in priority categories so command center ordering and triage stay aligned.',
                'Use call and service actions from the command center once the visit is ready for rooming or provider handoff.',
                'When the board grows, use office filters here and detailed actions in `/admin/queue` to keep high-acuity flow moving.',
              ].map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#66433a]">
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Standard queue still active</p>
            </div>
            <div className="mt-4 space-y-3">
              {standard.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-8 text-center text-sm text-slate-400">
                  No standard visits waiting right now.
                </div>
              ) : (
                standard.slice(0, 6).map((ticket) => (
                  <div key={ticket.id} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{ticket.ticket_number}</p>
                        <p className="text-sm text-slate-500">{getCustomerName(ticket.customer_data)}</p>
                      </div>
                      <span className="text-xs text-slate-500">{formatElapsed(ticket.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function SeveritySection({
  title,
  description,
  tickets,
}: {
  title: string;
  description: string;
  tickets: Array<
    TriageTicket & {
      service: { name: string } | null;
      department: { name: string } | null;
      office: { name: string } | null;
      desk: { name?: string | null; display_name?: string | null } | null;
      category: PriorityCategory | null;
      derivedWeight: number;
    }
  >;
}) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">{description}</p>
      </div>

      <div className="mt-5 space-y-4">
        {tickets.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">
            No active visits in this severity lane.
          </div>
        ) : (
          tickets.map((ticket) => {
            const severity = getSeverity(ticket.derivedWeight);
            return (
              <article key={ticket.id} className={`rounded-[24px] border p-4 ${severity.panel}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${severity.tone}`}>
                        {severity.label}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        {ticket.ticket_number}
                      </span>
                      {ticket.category ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {ticket.category.name}
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-3 text-lg font-semibold text-slate-950">{getCustomerName(ticket.customer_data)}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {ticket.service?.name || 'General service'}
                      {ticket.department?.name ? ` · ${ticket.department.name}` : ''}
                      {ticket.office?.name ? ` · ${ticket.office.name}` : ''}
                    </p>
                  </div>

                  <div className="grid gap-2 text-right text-sm text-slate-500">
                    <span>{formatElapsed(ticket.created_at)}</span>
                    <span>Created {formatClock(ticket.created_at)}</span>
                    <span>{ticket.estimated_wait_minutes ? `${ticket.estimated_wait_minutes} min est.` : 'No estimate'}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <InfoPill label="Queue state" value={ticket.status} />
                  <InfoPill label="Weight" value={String(ticket.derivedWeight)} />
                  <InfoPill label="Assigned room" value={ticket.desk?.display_name || ticket.desk?.name || 'Not assigned'} />
                  <InfoPill label="Action path" value={ticket.status === 'waiting' || ticket.status === 'issued' ? 'Call from command center' : 'Continue live handoff'} />
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function HeroStat({ label, value, helper, suffix = '' }: { label: string; value: number; helper: string; suffix?: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}{suffix}</p>
      <p className="mt-1 text-sm text-white/65">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(20,27,26,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium capitalize text-slate-900">{value}</p>
    </div>
  );
}
