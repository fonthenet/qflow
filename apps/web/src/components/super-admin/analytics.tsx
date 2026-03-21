'use client';

import { BarChart3, TrendingUp, TicketCheck, Clock, Users, Building2, ArrowUpRight, Activity } from 'lucide-react';

interface OrgAnalytics {
  id: string;
  name: string;
  totalTickets: number;
  todayTickets: number;
  staffCount: number;
  avgWaitTime: number;
  avgServiceTime: number;
}

interface HourlyData {
  hour: number;
  count: number;
}

interface Props {
  orgAnalytics: OrgAnalytics[];
  dailyTickets: { date: string; count: number }[];
  hourlyDistribution: HourlyData[];
  totalTickets: number;
  totalToday: number;
  avgWaitTime: number;
  avgServiceTime: number;
  noShowRate: number;
}

export function PlatformAnalytics({
  orgAnalytics,
  dailyTickets,
  hourlyDistribution,
  totalTickets,
  totalToday,
  avgWaitTime,
  avgServiceTime,
  noShowRate,
}: Props) {
  const maxDaily = Math.max(...dailyTickets.map(d => d.count), 1);
  const maxOrgTickets = Math.max(...orgAnalytics.map(o => o.totalTickets), 1);
  const maxHourly = Math.max(...hourlyDistribution.map(h => h.count), 1);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Performance metrics across all organizations</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard label="Total Tickets" value={totalTickets.toLocaleString()} icon={TicketCheck} color="blue" />
        <KPICard label="Today" value={totalToday.toString()} icon={TrendingUp} color="emerald" />
        <KPICard label="Avg Wait" value={`${avgWaitTime}m`} icon={Clock} color="amber" />
        <KPICard label="Avg Service" value={`${avgServiceTime}m`} icon={Activity} color="purple" />
        <KPICard label="No-Show Rate" value={`${noShowRate}%`} icon={Users} color={noShowRate > 20 ? 'red' : 'slate'} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Daily Volume - 2 cols */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 text-sm">Ticket Volume — Last 30 Days</h3>
            <span className="text-xs text-slate-400">{dailyTickets.reduce((sum, d) => sum + d.count, 0).toLocaleString()} total</span>
          </div>
          <div className="flex items-end gap-[3px] h-44">
            {dailyTickets.map((d) => (
              <div key={d.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
                <div
                  className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-sm transition-all group-hover:from-blue-600 group-hover:to-blue-500 min-h-[2px]"
                  style={{ height: `${(d.count / maxDaily) * 100}%` }}
                />
                <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10 pointer-events-none">
                  {d.date.slice(5)}: {d.count} tickets
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-slate-400">
            <span>{dailyTickets[0]?.date.slice(5)}</span>
            <span>{dailyTickets[Math.floor(dailyTickets.length / 2)]?.date.slice(5)}</span>
            <span>{dailyTickets[dailyTickets.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        {/* Hourly Distribution */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <h3 className="font-semibold text-slate-900 text-sm mb-4">Peak Hours Today</h3>
          <div className="space-y-1.5">
            {hourlyDistribution.filter(h => h.count > 0).map(h => (
              <div key={h.hour} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-8 text-right font-mono">
                  {String(h.hour).padStart(2, '0')}:00
                </span>
                <div className="flex-1 h-4 bg-slate-50 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded transition-all"
                    style={{ width: `${(h.count / maxHourly) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-600 font-medium w-6">{h.count}</span>
              </div>
            ))}
            {hourlyDistribution.filter(h => h.count > 0).length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">No ticket data for today</div>
            )}
          </div>
        </div>
      </div>

      {/* Org Rankings */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">Organizations by Performance</h3>
            <p className="text-xs text-slate-400 mt-0.5">Sorted by total ticket volume</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Organization</th>
                <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Today</th>
                <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total</th>
                <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Staff</th>
                <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Avg Wait</th>
                <th className="px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-48">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {orgAnalytics.map((org, i) => (
                <tr key={org.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-3 text-xs text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium text-slate-900">{org.name}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-semibold ${org.todayTickets > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {org.todayTickets}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-700">{org.totalTickets.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{org.staffCount}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{org.avgWaitTime > 0 ? `${org.avgWaitTime}m` : '—'}</td>
                  <td className="px-5 py-3">
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                        style={{ width: `${(org.totalTickets / maxOrgTickets) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgAnalytics.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">No data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    red: 'bg-red-50 text-red-600 border-red-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100',
  };
  const c = colorMap[color] ?? colorMap.slate;

  return (
    <div className={`rounded-xl border p-4 ${c}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
