import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Award, Repeat2, Star, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type Customer = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  visit_count: number | null;
  last_visit_at: string | null;
  created_at: string | null;
};

function getTier(visitCount: number) {
  if (visitCount >= 20) return { label: 'Platinum', tone: 'bg-violet-50 text-violet-700 border-violet-200' };
  if (visitCount >= 10) return { label: 'Gold', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (visitCount >= 5) return { label: 'Silver', tone: 'bg-slate-100 text-slate-600 border-slate-200' };
  return { label: 'Emerging', tone: 'bg-sky-50 text-sky-700 border-sky-200' };
}

function formatDate(value: string | null) {
  if (!value) return '--';
  return new Date(value).toLocaleDateString();
}

function formatRelative(value: string | null) {
  if (!value) return '--';
  const diffDays = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

export default async function LoyaltyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, organization:organizations(name, business_type)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  const organization = Array.isArray(staff.organization) ? staff.organization[0] || null : staff.organization;

  const [customersResult, priorityUsageResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, phone, email, visit_count, last_visit_at, created_at')
      .eq('organization_id', staff.organization_id)
      .order('visit_count', { ascending: false })
      .limit(24),
    supabase
      .from('tickets')
      .select('customer_id, priority, created_at')
      .not('customer_id', 'is', null)
      .gt('priority', 0)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const customers = (customersResult.data || []) as Customer[];
  const priorityUsage = priorityUsageResult.data || [];

  const priorityCounts = new Map<string, number>();
  priorityUsage.forEach((ticket) => {
    if (!ticket.customer_id) return;
    priorityCounts.set(ticket.customer_id, (priorityCounts.get(ticket.customer_id) || 0) + 1);
  });

  const enrichedCustomers = customers.map((customer) => {
    const visits = customer.visit_count || 0;
    return {
      ...customer,
      visits,
      tier: getTier(visits),
      priorityUses: priorityCounts.get(customer.id) || 0,
    };
  });

  const loyaltyMembers = enrichedCustomers.filter((customer) => customer.visits >= 5);
  const heavyRepeat = enrichedCustomers.filter((customer) => customer.visits >= 10);
  const recentActive = enrichedCustomers.filter((customer) => customer.last_visit_at && Date.now() - new Date(customer.last_visit_at).getTime() < 30 * 86400000);
  const avgVisits = enrichedCustomers.length
    ? Math.round(enrichedCustomers.reduce((total, customer) => total + customer.visits, 0) / enrichedCustomers.length)
    : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#27494f_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Repeat-customer flow</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Loyalty priority is now grounded in actual customer history, not a future rewards system.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              Use this page to identify repeat customers, see which people already earn faster handling, and decide where loyalty rules should become explicit priority policy.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Loyalty members" value={loyaltyMembers.length.toString()} helper="5+ recorded visits" />
            <HeroStat label="High-frequency" value={heavyRepeat.length.toString()} helper="10+ recorded visits" />
            <HeroStat label="Recent active" value={recentActive.length.toString()} helper="Visited in the last 30 days" />
            <HeroStat label="Avg visits" value={avgVisits.toString()} helper="Across the top customer list" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Tracked customers" value={enrichedCustomers.length.toString()} helper="Top recent customers in this org" />
        <MetricCard label="Priority uses" value={Array.from(priorityCounts.values()).reduce((total, count) => total + count, 0).toString()} helper="Historical elevated visits captured" />
        <MetricCard label="Repeat signal" value={`${loyaltyMembers.length ? Math.round((loyaltyMembers.length / enrichedCustomers.length) * 100) : 0}%`} helper="Share of listed customers at 5+ visits" />
        <MetricCard label="Action path" value="Priorities" helper="Use priority rules to formalize benefits today" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Repeat customers</h2>
              <p className="mt-1 text-sm leading-7 text-slate-500">
                Customer history ranked by visit count, with an inferred tier so teams can decide who deserves explicit fast-track treatment.
              </p>
            </div>
            <Link href="/admin/customers" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Open customer history
            </Link>
          </div>

          <div className="mt-5 space-y-4">
            {enrichedCustomers.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
                No customer history is available yet.
              </div>
            ) : (
              enrichedCustomers.map((customer) => (
                <article key={customer.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${customer.tier.tone}`}>
                          {customer.tier.label}
                        </span>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {customer.visits} visits
                        </span>
                        {customer.priorityUses > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                            {customer.priorityUses} priority uses
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-slate-950">{customer.name || 'Unnamed customer'}</h3>
                      <p className="mt-1 text-sm text-slate-500">{customer.phone || customer.email || 'No direct contact saved'}</p>
                    </div>

                    <div className="grid gap-2 text-right text-sm text-slate-500">
                      <span>Last visit {formatRelative(customer.last_visit_at)}</span>
                      <span>Joined {formatDate(customer.created_at)}</span>
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
              <Award className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Suggested tiers</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Emerging', detail: '1-4 visits', tone: 'bg-sky-50 text-sky-700' },
                { label: 'Silver', detail: '5-9 visits', tone: 'bg-slate-100 text-slate-600' },
                { label: 'Gold', detail: '10-19 visits', tone: 'bg-amber-50 text-amber-700' },
                { label: 'Platinum', detail: '20+ visits', tone: 'bg-violet-50 text-violet-700' },
              ].map((tier) => (
                <div key={tier.label} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tier.tone}`}>{tier.label}</span>
                    <span className="text-sm text-slate-500">{tier.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
            <div className="flex items-center gap-2">
              <Repeat2 className="h-4 w-4 text-[#446068]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">Loyalty playbook</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                'Use visit count as the current trust signal until a dedicated loyalty schema exists.',
                'Customers who repeatedly receive elevated priority are the clearest candidates for a formal loyalty policy.',
                'Turn these tiers into explicit routing rules through priority categories when you are ready to operationalize them.',
              ].map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Next actions</p>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Open priorities', href: '/admin/priorities' },
                { label: 'Open command center', href: '/admin/queue' },
                { label: 'Open customers', href: '/admin/customers' },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300">
                  {item.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
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
