'use client';

import { BarChart3, TrendingUp, TicketCheck } from 'lucide-react';

interface OrgAnalytics {
  id: string;
  name: string;
  totalTickets: number;
  todayTickets: number;
  staffCount: number;
}

interface Props {
  orgAnalytics: OrgAnalytics[];
  dailyTickets: { date: string; count: number }[];
  totalTickets: number;
  totalToday: number;
}

export function PlatformAnalytics({ orgAnalytics, dailyTickets, totalTickets, totalToday }: Props) {
  const maxDaily = Math.max(...dailyTickets.map(d => d.count), 1);
  const maxOrgTickets = Math.max(...orgAnalytics.map(o => o.totalTickets), 1);

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Platform Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Ticket volume and organization activity across the platform</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <TicketCheck size={18} className="text-white" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Tickets</p>
          </div>
          <p className="text-3xl font-bold">{totalTickets.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
              <TrendingUp size={18} className="text-white" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Today</p>
          </div>
          <p className="text-3xl font-bold">{totalToday}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <BarChart3 size={18} className="text-white" />
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Active Orgs</p>
          </div>
          <p className="text-3xl font-bold">{orgAnalytics.filter(o => o.todayTickets > 0).length}</p>
        </div>
      </div>

      {/* Daily chart (last 30 days) */}
      <div className="rounded-xl border border-border bg-background p-5">
        <h3 className="font-semibold mb-4">Tickets — Last 30 Days</h3>
        <div className="flex items-end gap-1 h-40">
          {dailyTickets.map((d, i) => (
            <div key={d.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
              <div
                className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t transition-all group-hover:from-blue-600 group-hover:to-blue-500 min-h-[2px]"
                style={{ height: `${(d.count / maxDaily) * 100}%` }}
              />
              <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                {d.date.slice(5)}: {d.count}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
          <span>{dailyTickets[0]?.date.slice(5)}</span>
          <span>{dailyTickets[dailyTickets.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      {/* Org rankings */}
      <div className="rounded-xl border border-border bg-background">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold">Organizations by Volume</h3>
        </div>
        <div className="divide-y divide-border">
          {orgAnalytics.map((org, i) => (
            <div key={org.id} className="px-5 py-3 flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-6 text-right font-mono">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate">{org.name}</span>
                  <div className="flex gap-4 text-xs text-muted-foreground shrink-0">
                    <span><strong className="text-foreground">{org.todayTickets}</strong> today</span>
                    <span><strong className="text-foreground">{org.totalTickets.toLocaleString()}</strong> total</span>
                    <span>{org.staffCount} staff</span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                    style={{ width: `${(org.totalTickets / maxOrgTickets) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
          {orgAnalytics.length === 0 && (
            <div className="px-5 py-12 text-center text-muted-foreground text-sm">No data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
