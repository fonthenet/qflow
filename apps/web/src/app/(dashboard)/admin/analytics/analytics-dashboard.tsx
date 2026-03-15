'use client';

import { useState, useTransition } from 'react';
import {
  TicketCheck,
  Clock,
  Timer,
  Star,
  RefreshCw,
} from 'lucide-react';
import {
  getAnalyticsSummary,
  getTicketsByHour,
  getTicketsByDepartment,
  getWaitTimeTrend,
  getStaffPerformance,
  getFeedbackSummary,
  type AnalyticsSummary,
  type HourlyTicket,
  type DepartmentTicket,
  type WaitTimeTrend,
  type StaffPerformanceRow,
  type FeedbackSummaryData,
} from '@/lib/actions/analytics-actions';

interface AnalyticsDashboardProps {
  initialSummary: AnalyticsSummary;
  initialTicketsByHour: HourlyTicket[];
  initialTicketsByDepartment: DepartmentTicket[];
  initialWaitTimeTrend: WaitTimeTrend[];
  initialStaffPerformance: StaffPerformanceRow[];
  initialFeedbackSummary: FeedbackSummaryData;
  offices: { id: string; name: string }[];
  departments: { id: string; name: string; office_id: string }[];
}

export function AnalyticsDashboard({
  initialSummary,
  initialTicketsByHour,
  initialTicketsByDepartment,
  initialWaitTimeTrend,
  initialStaffPerformance,
  initialFeedbackSummary,
  offices,
  departments,
}: AnalyticsDashboardProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [ticketsByHour, setTicketsByHour] = useState(initialTicketsByHour);
  const [ticketsByDepartment, setTicketsByDepartment] = useState(
    initialTicketsByDepartment
  );
  const [waitTimeTrend, setWaitTimeTrend] = useState(initialWaitTimeTrend);
  const [staffPerformance, setStaffPerformance] = useState(
    initialStaffPerformance
  );
  const [feedbackSummary, setFeedbackSummary] = useState(
    initialFeedbackSummary
  );

  const [selectedOffice, setSelectedOffice] = useState<string>('');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('today');
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(async () => {
      const officeId = selectedOffice || undefined;
      const dateRange = selectedDateRange || undefined;
      const days =
        dateRange === 'last30' ? 30 : dateRange === 'last7' ? 7 : 7;

      const [s, tbh, tbd, wtt, sp, fs] = await Promise.all([
        getAnalyticsSummary(officeId, dateRange),
        getTicketsByHour(officeId),
        getTicketsByDepartment(officeId, dateRange),
        getWaitTimeTrend(officeId, days),
        getStaffPerformance(officeId, dateRange),
        getFeedbackSummary(officeId, dateRange),
      ]);

      setSummary(s);
      setTicketsByHour(tbh);
      setTicketsByDepartment(tbd);
      setWaitTimeTrend(wtt);
      setStaffPerformance(sp);
      setFeedbackSummary(fs);
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Command center intelligence</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Analytics and service health</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Watch demand, wait pressure, service pacing, and satisfaction trends across every arrival mode and workspace.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value)}
              className="rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-[#10292f]"
            >
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
            </select>

            <select
              value={selectedOffice}
              onChange={(e) => setSelectedOffice(e.target.value)}
              className="rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-[#10292f]"
            >
              <option value="">All offices</option>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleRefresh}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#173740] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
              Refresh view
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total Tickets"
          value={summary.totalTicketsToday.toString()}
          subtitle={
            selectedDateRange === 'today'
              ? 'today'
              : selectedDateRange === 'last7'
                ? 'last 7 days'
                : 'last 30 days'
          }
          icon={<TicketCheck className="h-5 w-5" />}
          iconBg="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
        />
        <SummaryCard
          label="Avg Wait Time"
          value={
            summary.avgWaitTime !== null ? `${summary.avgWaitTime} min` : '--'
          }
          subtitle="created to serving"
          icon={<Clock className="h-5 w-5" />}
          iconBg="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
        />
        <SummaryCard
          label="Avg Service Time"
          value={
            summary.avgServiceTime !== null
              ? `${summary.avgServiceTime} min`
              : '--'
          }
          subtitle="serving to completed"
          icon={<Timer className="h-5 w-5" />}
          iconBg="bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
        />
        <SummaryCard
          label="Satisfaction"
          value={
            summary.avgSatisfaction !== null
              ? `${summary.avgSatisfaction}/5`
              : '--'
          }
          subtitle={`${feedbackSummary.totalFeedback} ratings`}
          icon={<Star className="h-5 w-5" />}
          iconBg="bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
            Tickets by Hour (Today)
          </h3>
          <TicketsByHourChart data={ticketsByHour} />
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
            Tickets by Department
          </h3>
          <DepartmentBarChart data={ticketsByDepartment} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
            Wait Time Trend
          </h3>
          <WaitTimeTrendChart data={waitTimeTrend} />
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <FeedbackDistribution data={feedbackSummary} />
        </section>
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
          Staff Performance
        </h3>
        <StaffPerformanceTable data={staffPerformance} />
      </section>

      {feedbackSummary.recentComments.length > 0 && (
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
            Recent Feedback Comments
          </h3>
          <div className="space-y-3">
            {feedbackSummary.recentComments.map((c) => (
              <div
                key={c.id}
                className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4"
              >
                <div className="mb-1 flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i < c.rating
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-slate-300'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-slate-500">
                    {c.staff_name && `Staff: ${c.staff_name}`}
                    {c.service_name && ` | Service: ${c.service_name}`}
                  </span>
                </div>
                <p className="text-sm text-slate-900">{c.comment}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Summary Card                                                              */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  label,
  value,
  subtitle,
  icon,
  iconBg,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className={`rounded-2xl p-2 ${iconBg}`}>{icon}</div>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tickets by Hour  (vertical bar chart, hours 6-22)                         */
/* -------------------------------------------------------------------------- */

function TicketsByHourChart({ data }: { data: HourlyTicket[] }) {
  const filtered = data.filter((d) => d.hour >= 6 && d.hour <= 22);
  const maxCount = Math.max(...filtered.map((d) => d.count), 1);

  if (filtered.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No hourly ticket data available
      </p>
    );
  }

  return (
    <div className="flex items-end gap-1 h-52">
      {filtered.map((d) => {
        const pct = Math.max((d.count / maxCount) * 100, 2);
        return (
          <div
            key={d.hour}
            className="group relative flex flex-1 flex-col items-center gap-1"
          >
            {/* Count label */}
            <span className="text-[10px] font-medium text-muted-foreground">
              {d.count > 0 ? d.count : ''}
            </span>
            {/* Bar */}
            <div
              className="w-full rounded-t bg-primary/80 transition-all group-hover:bg-primary"
              style={{ height: `${pct}%`, minHeight: '2px' }}
            />
            {/* Hour label */}
            <span className="text-[10px] text-muted-foreground">
              {d.hour.toString().padStart(2, '0')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tickets by Department  (horizontal bar chart with colored bars)           */
/* -------------------------------------------------------------------------- */

const DEPARTMENT_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-amber-500',
];

function DepartmentBarChart({ data }: { data: DepartmentTicket[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No department data available
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const color = DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length];
        const widthPct = (d.count / maxCount) * 100;
        return (
          <div key={d.department_id}>
            <div className="mb-1 flex items-center justify-between">
              <span className="max-w-[60%] truncate text-sm text-foreground">
                {d.department_name}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                {d.count}
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-muted">
              <div
                className={`h-3 rounded-full ${color} transition-all`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Wait Time Trend  (bar chart per day)                                      */
/* -------------------------------------------------------------------------- */

function WaitTimeTrendChart({ data }: { data: WaitTimeTrend[] }) {
  const maxWait = Math.max(...data.map((d) => d.avgWaitMinutes), 1);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No wait time data available
      </p>
    );
  }

  return (
    <div className="flex items-end gap-2 h-52">
      {data.map((d) => {
        const pct = Math.max((d.avgWaitMinutes / maxWait) * 100, 2);
        const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString(
          undefined,
          { weekday: 'short', month: 'short', day: 'numeric' }
        );
        return (
          <div
            key={d.date}
            className="group relative flex flex-1 flex-col items-center gap-1"
          >
            <span className="text-[10px] font-medium text-muted-foreground">
              {d.avgWaitMinutes > 0 ? `${d.avgWaitMinutes}m` : ''}
            </span>
            <div
              className="w-full rounded-t bg-amber-500/70 transition-all group-hover:bg-amber-500"
              style={{ height: `${pct}%`, minHeight: '2px' }}
            />
            <span className="text-center text-[10px] leading-tight text-muted-foreground">
              {dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Feedback Summary  (star distribution + big average + recent comments)     */
/* -------------------------------------------------------------------------- */

const STAR_BAR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-green-500',
];

function FeedbackDistribution({ data }: { data: FeedbackSummaryData }) {
  const maxCount = Math.max(...data.distribution.map((d) => d.count), 1);

  // Sort distribution 5 -> 1 for display
  const sorted = [...data.distribution].sort((a, b) => b.rating - a.rating);

  return (
    <div>
      <h3 className="mb-4 text-sm font-semibold text-foreground">
        Feedback Summary
      </h3>

      <div className="flex gap-6">
        {/* Big average number */}
        <div className="flex flex-col items-center justify-center gap-1 min-w-[80px]">
          <span className="text-4xl font-bold text-foreground">
            {data.averageRating !== null ? data.averageRating : '--'}
          </span>
          {data.averageRating !== null && (
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-4 w-4 ${
                    i < Math.round(data.averageRating ?? 0)
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-muted-foreground/30'
                  }`}
                />
              ))}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {data.totalFeedback} ratings
          </span>
        </div>

        {/* Star distribution bars (5 to 1) */}
        <div className="flex-1 space-y-2">
          {sorted.map((d) => {
            const colorIdx = d.rating - 1;
            const color = STAR_BAR_COLORS[colorIdx] ?? 'bg-primary';
            const widthPct =
              d.count > 0 ? (d.count / maxCount) * 100 : 0;
            return (
              <div key={d.rating} className="flex items-center gap-2">
                <span className="w-12 text-right text-xs text-muted-foreground">
                  {d.rating} star{d.rating !== 1 ? 's' : ''}
                </span>
                <div className="h-3 flex-1 rounded-full bg-muted">
                  <div
                    className={`h-3 rounded-full ${color} transition-all`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="w-8 text-xs text-muted-foreground">
                  {d.count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Staff Performance Table                                                   */
/* -------------------------------------------------------------------------- */

function StaffPerformanceTable({ data }: { data: StaffPerformanceRow[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No staff performance data available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-3 pr-4 font-medium text-muted-foreground">
              Staff Name
            </th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">
              Tickets Served
            </th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">
              Avg Service Time
            </th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">
              Avg Rating
            </th>
            <th className="pb-3 text-right font-medium text-muted-foreground">
              No-Shows
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr key={row.staff_id} className="hover:bg-muted/30 transition-colors">
              <td className="py-3 pr-4 font-medium text-foreground">
                {row.staff_name}
              </td>
              <td className="py-3 pr-4 text-right text-foreground">
                {row.tickets_served}
              </td>
              <td className="py-3 pr-4 text-right text-foreground">
                {row.avg_service_time !== null
                  ? `${row.avg_service_time} min`
                  : '--'}
              </td>
              <td className="py-3 pr-4 text-right">
                {row.avg_rating !== null ? (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    {row.avg_rating}
                    <span className="inline-flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${
                            i < Math.round(row.avg_rating ?? 0)
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-muted-foreground/30'
                          }`}
                        />
                      ))}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </td>
              <td className="py-3 text-right">
                <span
                  className={
                    row.no_show_count > 0
                      ? 'font-medium text-destructive'
                      : 'text-foreground'
                  }
                >
                  {row.no_show_count}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
