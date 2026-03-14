'use client';

import { Building2, Users, MapPin, Ticket, TrendingUp } from 'lucide-react';

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

const statusColors: Record<string, string> = {
  waiting: 'bg-amber-50 text-amber-700',
  called: 'bg-blue-50 text-blue-700',
  serving: 'bg-emerald-50 text-emerald-700',
  served: 'bg-gray-100 text-gray-600',
  no_show: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-400',
};

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-50 text-blue-700',
  growth: 'bg-emerald-50 text-emerald-700',
  pro: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
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
  const statCards = [
    { label: 'Organizations', value: stats.totalOrgs, icon: Building2, color: 'text-gray-900' },
    { label: 'Staff Members', value: stats.totalStaff, icon: Users, color: 'text-gray-900' },
    { label: 'Locations', value: stats.totalOffices, icon: MapPin, color: 'text-gray-900' },
    { label: 'Tickets Today', value: stats.todayTickets, icon: Ticket, color: 'text-gray-900' },
    { label: 'Total Tickets', value: stats.totalTickets, icon: TrendingUp, color: 'text-gray-900' },
  ];

  // Plan distribution
  const planCounts: Record<string, number> = {};
  organizations.forEach((org) => {
    const plan = org.plan_id || 'free';
    planCounts[plan] = (planCounts[plan] || 0) + 1;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor your QueueFlow platform across all organizations.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-200 bg-white p-5"
          >
            <div className="flex items-center justify-between">
              <stat.icon className="h-5 w-5 text-gray-400" />
            </div>
            <p className="mt-3 text-2xl font-bold text-gray-900">
              {stat.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Plan Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-900">Plan Distribution</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(planCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([plan, count]) => {
                const percent = Math.round((count / organizations.length) * 100);
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium capitalize text-gray-700">{plan}</span>
                      <span className="text-gray-500">
                        {count} org{count !== 1 ? 's' : ''} ({percent}%)
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-900 transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Top Organizations by Volume */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-900">Top Organizations (by visits this month)</h3>
          <div className="mt-4 divide-y divide-gray-100">
            {organizations
              .sort((a, b) => (b.monthly_visit_count || 0) - (a.monthly_visit_count || 0))
              .slice(0, 5)
              .map((org) => (
                <div key={org.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{org.name}</p>
                    <p className="text-xs text-gray-400">/{org.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${planColors[org.plan_id || 'free'] || planColors.free}`}>
                      {org.plan_id || 'free'}
                    </span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">
                      {(org.monthly_visit_count || 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
        <div className="mt-4 divide-y divide-gray-100">
          {recentTickets.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No recent activity</p>
          ) : (
            recentTickets.map((ticket) => (
              <div key={ticket.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-mono font-semibold text-gray-900">
                    {ticket.ticket_number}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 truncate">
                      {ticket.customer_name || 'Walk-in'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {(ticket.service as any)?.name} &middot; {(ticket.office as any)?.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[ticket.status] || 'bg-gray-100 text-gray-500'}`}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
