'use client';

import { AlertTriangle, Building2, CreditCard, MapPin, Ticket, TrendingUp, Users } from 'lucide-react';

interface Stats {
  totalOrgs: number;
  totalStaff: number;
  totalOffices: number;
  todayTickets: number;
  totalTickets: number;
}

interface Org {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
  subscription_status: string | null;
  created_at: string;
  monthly_visit_count: number | null;
}

interface RecentTicket {
  id: string;
  ticket_number: string;
  status: string;
  customer_name: string | null;
  created_at: string;
  service: { name: string } | null;
  office: { name: string } | null;
}

const planColors: Record<string, string> = {
  free: 'bg-slate-100 text-slate-600',
  starter: 'bg-sky-50 text-sky-700',
  growth: 'bg-emerald-50 text-emerald-700',
  pro: 'bg-amber-50 text-amber-700',
  enterprise: 'bg-rose-50 text-rose-700',
};

const statusColors: Record<string, string> = {
  waiting: 'bg-amber-50 text-amber-700',
  called: 'bg-sky-50 text-sky-700',
  serving: 'bg-emerald-50 text-emerald-700',
  served: 'bg-slate-100 text-slate-600',
  no_show: 'bg-rose-50 text-rose-600',
  cancelled: 'bg-slate-100 text-slate-400',
};

export function PlatformDashboardClient({
  stats,
  organizations,
  recentTickets,
}: {
  stats: Stats;
  organizations: Org[];
  recentTickets: RecentTicket[];
}) {
  const planCounts: Record<string, number> = {};
  organizations.forEach((org) => {
    const plan = org.plan_id || 'free';
    planCounts[plan] = (planCounts[plan] || 0) + 1;
  });

  const billingRiskCount = organizations.filter((org) => !['active', 'trialing'].includes(org.subscription_status || '')).length;
  const topOrganizations = [...organizations]
    .sort((a, b) => (b.monthly_visit_count || 0) - (a.monthly_visit_count || 0))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#173740_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Platform overview</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Own growth, risk, and live platform health from one console.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              Monitor organizations, live traffic, subscription health, and operator load without bouncing between disconnected admin pages.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Organizations', value: stats.totalOrgs },
              { label: 'Active staff', value: stats.totalStaff },
              { label: 'Locations', value: stats.totalOffices },
              { label: 'Billing risk', value: billingRiskCount },
            ].map((item) => (
              <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{item.value.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Visits today', value: stats.todayTickets, icon: Ticket },
              { label: 'Lifetime visits', value: stats.totalTickets, icon: TrendingUp },
              { label: 'Staff footprint', value: stats.totalStaff, icon: Users },
            ].map((card) => (
              <div key={card.label} className="rounded-[24px] bg-[#f6f7f4] p-4">
                <card.icon className="h-5 w-5 text-slate-400" />
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{card.value.toLocaleString()}</p>
                <p className="mt-1 text-sm text-slate-500">{card.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Plan mix</p>
              <div className="mt-4 space-y-3">
                {Object.entries(planCounts)
                  .sort(([, left], [, right]) => right - left)
                  .map(([plan, count]) => (
                    <div key={plan}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize text-slate-700">{plan}</span>
                        <span className="text-slate-500">{count} orgs</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#10292f]"
                          style={{ width: `${Math.max(8, Math.round((count / Math.max(organizations.length, 1)) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Risk snapshot</p>
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-3 rounded-[20px] bg-[#fff2e3] p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{billingRiskCount} organizations need billing attention.</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">Use the billing area to review subscription states that are not active or trialing.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-[20px] bg-[#edf7f2] p-4">
                  <Building2 className="mt-0.5 h-4 w-4 text-emerald-700" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{stats.totalOrgs} organizations are currently represented in the platform.</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">This includes all plan tiers and all active location footprints.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Top organizations this month</p>
          <div className="mt-4 space-y-3">
            {topOrganizations.map((org) => (
              <div key={org.id} className="flex items-center justify-between rounded-[22px] bg-[#f6f7f4] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{org.name}</p>
                  <p className="mt-1 text-xs text-slate-500">/{org.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${planColors[org.plan_id || 'free'] || planColors.free}`}>
                    {org.plan_id || 'free'}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{(org.monthly_visit_count || 0).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Live activity</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Recent platform traffic</h2>
          </div>
        </div>

        <div className="mt-5 divide-y divide-slate-100">
          {recentTickets.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No recent activity yet.</p>
          ) : (
            recentTickets.map((ticket) => (
              <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{ticket.ticket_number}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusColors[ticket.status] || 'bg-slate-100 text-slate-500'}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{ticket.customer_name || 'Walk-in customer'}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {(ticket.office as any)?.name} • {(ticket.service as any)?.name}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-slate-400">
                  {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
