import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Crown, Sparkles, Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type JoinedName = { name: string } | { name: string }[] | null;
type PriorityCategory = {
  id: string;
  name: string;
  color: string | null;
  weight: number | null;
  icon: string | null;
};

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

function getCustomerName(value: Record<string, unknown> | null) {
  if (value && typeof value.name === 'string' && value.name.trim()) return value.name;
  return 'Walk-in guest';
}

function formatElapsed(value: string | null) {
  if (!value) return '--';
  const diff = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (diff < 60) return `${diff} min`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

export default async function VipRoutingPage({
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

  const [categoriesResult, ticketsResult] = await Promise.all([
    supabase
      .from('priority_categories')
      .select('id, name, color, weight, icon')
      .eq('organization_id', staff.organization_id)
      .eq('is_active', true)
      .order('weight', { ascending: false }),
    selectedOfficeId
      ? supabase
          .from('tickets')
          .select(
            'id, ticket_number, status, created_at, called_at, serving_started_at, priority, customer_data, priority_category_id, service:services(name), department:departments(name), desk:desks(name, display_name)'
          )
          .eq('office_id', selectedOfficeId)
          .in('status', ['issued', 'waiting', 'called', 'serving'])
          .gt('priority', 0)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const categories = (categoriesResult.data || []) as PriorityCategory[];
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const vipTickets = (ticketsResult.data || []).map((ticket: Record<string, unknown>) => {
    const categoryId = (ticket.priority_category_id as string | null) ?? null;
    return {
      id: String(ticket.id),
      ticket_number: String(ticket.ticket_number),
      status: String(ticket.status),
      created_at: (ticket.created_at as string | null) ?? null,
      called_at: (ticket.called_at as string | null) ?? null,
      serving_started_at: (ticket.serving_started_at as string | null) ?? null,
      priority: (ticket.priority as number | null) ?? 0,
      customer_data: (ticket.customer_data as Record<string, unknown> | null) ?? null,
      service: normalizeJoin(ticket.service as JoinedName),
      department: normalizeJoin(ticket.department as JoinedName),
      desk: normalizeJoin(ticket.desk as { name?: string | null; display_name?: string | null } | { name?: string | null; display_name?: string | null }[] | null),
      category: categoryId ? categoriesById.get(categoryId) || null : null,
    };
  });

  const calledCount = vipTickets.filter((ticket) => ticket.status === 'called').length;
  const servingCount = vipTickets.filter((ticket) => ticket.status === 'serving').length;
  const avgWait = vipTickets.length
    ? Math.round(
        vipTickets.reduce((total, ticket) => {
          if (!ticket.created_at) return total;
          return total + (Date.now() - new Date(ticket.created_at).getTime()) / 60000;
        }, 0) / vipTickets.length
      )
    : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#2e1d10_0%,_#5d3916_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(46,29,16,0.16)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ffd392]">Priority orchestration</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              VIP routing is now anchored to live priority tickets instead of static rules on paper.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              This board shows every active elevated visit, the category behind it, and how those visits are moving through the live queue.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="VIP visits now" value={vipTickets.length.toString()} helper="Active tickets with elevated priority" />
            <HeroStat label="Called" value={calledCount.toString()} helper="Currently being brought forward" />
            <HeroStat label="Serving" value={servingCount.toString()} helper="Already in service" />
            <HeroStat label="Avg elevated wait" value={avgWait.toString()} helper="Minutes across active VIP flow" suffix="m" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <form action="/admin/vip-routing" className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Office</span>
              <select name="office" defaultValue={selectedOfficeId} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none">
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>{office.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Apply
            </button>
          </form>

          <div className="flex gap-3">
            <Link href="/admin/priorities" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Manage priority categories
            </Link>
            <Link href="/admin/queue" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2e1d10] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5d3916]">
              Open command center
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Priority rules" value={categories.length.toString()} helper="Active categories available for routing" />
        <MetricCard label="Highest urgency" value={`${categories[0]?.weight ?? 0}`} helper={categories[0]?.name || 'No categories yet'} />
        <MetricCard label="Waiting VIPs" value={vipTickets.filter((ticket) => ticket.status === 'waiting' || ticket.status === 'issued').length.toString()} helper="Still waiting to be called" />
        <MetricCard label="Live routing" value="Enabled" helper="Command center honors the same priority order" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Active elevated visits</h2>
            <p className="mt-1 text-sm leading-7 text-slate-500">
              Every active visit with a non-zero priority weight, ordered by urgency first and arrival time second.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {vipTickets.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
                No elevated visits are active in this office right now.
              </div>
            ) : (
              vipTickets.map((ticket) => (
                <article key={ticket.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">{ticket.ticket_number}</span>
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Priority {ticket.priority}
                        </span>
                        {ticket.category ? (
                          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: ticket.category.color || '#6b7280' }}>
                            {ticket.category.icon || '★'} {ticket.category.name}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-slate-950">{getCustomerName(ticket.customer_data)}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {ticket.service?.name || 'General service'}
                        {ticket.department?.name ? ` · ${ticket.department.name}` : ''}
                      </p>
                    </div>

                    <div className="grid gap-2 text-right text-sm text-slate-500">
                      <span className="capitalize">{ticket.status}</span>
                      <span>{formatElapsed(ticket.created_at)} waiting</span>
                      <span>{ticket.desk?.display_name || ticket.desk?.name || 'No desk yet'}</span>
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
              <Star className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Priority categories</p>
            </div>
            <div className="mt-4 space-y-3">
              {categories.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">
                  No active priority categories yet.
                </div>
              ) : (
                categories.map((category) => (
                  <div key={category.id} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm text-white" style={{ backgroundColor: category.color || '#6b7280' }}>
                          {category.icon || '★'}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-900">{category.name}</p>
                          <p className="text-xs text-slate-500">Weight {category.weight ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#ead9c5] bg-[#fbf4ea] p-5">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-[#7a5a32]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a5a32]">VIP playbook</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                'Keep priority categories meaningful so staff can explain why someone is being accelerated through the flow.',
                'Use this page to monitor elevated load, then execute the actual call and handoff work in the command center.',
                'Priority alerts and VIP routing now share the same underlying ticket weight, so customer messaging stays aligned with routing decisions.',
              ].map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#664d2a]">
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Routing logic</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Priority > 0', text: 'Visit is eligible for elevated routing.' },
                { label: 'Category weight', text: 'Explains why one VIP visit outranks another.' },
                { label: 'Queue state', text: 'Command center decides the next operator action.' },
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

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(20,27,26,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}
