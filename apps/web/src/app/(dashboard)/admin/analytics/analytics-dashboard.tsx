'use client';

import React, { useState, useTransition } from 'react';
import {
  TicketCheck,
  Clock,
  Timer,
  Star,
  RefreshCw,
  ShieldCheck,
  GitBranchPlus,
  Activity,
} from 'lucide-react';
import {
  getAnalyticsSummary,
  getTicketsByHour,
  getTicketsByDepartment,
  getWaitTimeTrend,
  getStaffPerformance,
  getFeedbackSummary,
  getTemplateHealthAnalytics,
  getTemplatePerformanceAnalytics,
  type AnalyticsSummary,
  type HourlyTicket,
  type DepartmentTicket,
  type WaitTimeTrend,
  type StaffPerformanceRow,
  type FeedbackSummaryData,
  type TemplateHealthAnalyticsData,
  type TemplateActivityPoint,
  type TemplateDriftTrendPoint,
  type TemplateHealthOfficeRow,
  type TemplatePerformanceAnalyticsData,
  type TemplatePerformanceRow,
  type TemplateOfficeComparisonRow,
} from '@/lib/actions/analytics-actions';

interface AnalyticsDashboardProps {
  initialSummary: AnalyticsSummary;
  initialTicketsByHour: HourlyTicket[];
  initialTicketsByDepartment: DepartmentTicket[];
  initialWaitTimeTrend: WaitTimeTrend[];
  initialStaffPerformance: StaffPerformanceRow[];
  initialFeedbackSummary: FeedbackSummaryData;
  initialTemplateHealth: TemplateHealthAnalyticsData;
  initialTemplatePerformance: TemplatePerformanceAnalyticsData;
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
  initialTemplateHealth,
  initialTemplatePerformance,
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
  const [templateHealth, setTemplateHealth] = useState(initialTemplateHealth);
  const [templatePerformance, setTemplatePerformance] = useState(initialTemplatePerformance);

  const [selectedOffice, setSelectedOffice] = useState<string>('');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('today');
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(async () => {
      const officeId = selectedOffice || undefined;
      const dateRange = selectedDateRange || undefined;
      const days =
        dateRange === 'last30' ? 30 : dateRange === 'last7' ? 7 : 7;

      const [s, tbh, tbd, wtt, sp, fs, th, tp] = await Promise.all([
        getAnalyticsSummary(officeId, dateRange),
        getTicketsByHour(officeId),
        getTicketsByDepartment(officeId, dateRange),
        getWaitTimeTrend(officeId, days),
        getStaffPerformance(officeId, dateRange),
        getFeedbackSummary(officeId, dateRange),
        getTemplateHealthAnalytics(officeId, dateRange),
        getTemplatePerformanceAnalytics(officeId, dateRange),
      ]);

      setSummary(s);
      setTicketsByHour(tbh);
      setTicketsByDepartment(tbd);
      setWaitTimeTrend(wtt);
      setStaffPerformance(sp);
      setFeedbackSummary(fs);
      setTemplateHealth(th);
      setTemplatePerformance(tp);
    });
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">
            See the most useful numbers for wait times, service flow, feedback, and team performance.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={selectedDateRange}
          onChange={(e) => setSelectedDateRange(e.target.value)}
          aria-label="Date Range"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="today">Today</option>
          <option value="last7">Last 7 days</option>
          <option value="last30">Last 30 days</option>
        </select>

        <select
          value={selectedOffice}
          onChange={(e) => setSelectedOffice(e.target.value)}
          aria-label="Office Filter"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">All Locations</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <button
          onClick={handleRefresh}
          disabled={isPending}
          aria-label="Apply Filters"
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Update View
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Setup Rollout</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Track how well your business setup has been rolled out across locations and where local changes exist.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">{templateHealth.summary.templateTitle}</p>
            <p className="text-muted-foreground">
              Applied v{templateHealth.summary.appliedVersion} · Latest v{templateHealth.summary.latestVersion}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Locations up to date"
            value={`${templateHealth.summary.currentVersionCoveragePercent}%`}
            subtitle={`${templateHealth.summary.officesCurrentCount} of ${templateHealth.summary.officeCount} offices current`}
            icon={<ShieldCheck className="h-5 w-5" />}
            iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
          />
          <SummaryCard
            label="Local changes"
            value={templateHealth.summary.currentDriftCount.toString()}
            subtitle={
              templateHealth.summary.snapshotScope === 'office'
                ? `${templateHealth.summary.driftSnapshotCountInRange} snapshots in range`
                : `${templateHealth.summary.officesWithDrift} offices still drifted`
            }
            icon={<Activity className="h-5 w-5" />}
            iconBg="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400"
          />
          <SummaryCard
            label="Business updates"
            value={templateHealth.summary.organizationUpgradeCountInRange.toString()}
            subtitle={`${templateHealth.summary.totalOrganizationUpgradeCount} total · Last ${formatTimestamp(templateHealth.summary.lastMigrationAt)}`}
            icon={<RefreshCw className="h-5 w-5" />}
            iconBg="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400"
          />
          <SummaryCard
            label="Location rollouts"
            value={templateHealth.summary.officeRolloutCountInRange.toString()}
            subtitle={`${templateHealth.summary.totalOfficeRolloutCount} total · Last ${formatTimestamp(templateHealth.summary.lastOfficeRolloutAt)}`}
            icon={<GitBranchPlus className="h-5 w-5" />}
            iconBg="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr,1.1fr,0.9fr]">
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h4 className="mb-1 text-sm font-semibold text-foreground">Drift Trend</h4>
            <p className="mb-4 text-xs text-muted-foreground">
              {templateHealth.summary.snapshotScope === 'office'
                ? 'Office-level drift captured when this branch is updated.'
                : 'Organization drift snapshots captured during template changes and branch rollouts.'}
            </p>
            <TemplateDriftTrendChart
              data={templateHealth.driftTrend}
              scope={templateHealth.summary.snapshotScope}
            />
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h4 className="mb-4 text-sm font-semibold text-foreground">Template Activity</h4>
            <TemplateActivityChart data={templateHealth.activity} />
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h4 className="mb-4 text-sm font-semibold text-foreground">Office Version Status</h4>
            <TemplateOfficeStatusTable data={templateHealth.officeStatuses} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Business Performance</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare wait accuracy, no-shows, completion rate, and service time across your business types and locations.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">{formatVerticalLabel(templatePerformance.summary.primaryVertical)}</p>
            <p className="text-muted-foreground">
              {templatePerformance.summary.primaryTemplateTitle} · {templatePerformance.summary.templateCount} template group
              {templatePerformance.summary.templateCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Wait Accuracy"
            value={formatPercentValue(templatePerformance.summary.waitAccuracyPercent)}
            subtitle={`${templatePerformance.summary.totalTickets} tickets in scope`}
            icon={<Clock className="h-5 w-5" />}
            iconBg="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400"
          />
          <SummaryCard
            label="No-Show Rate"
            value={formatPercentValue(templatePerformance.summary.noShowRate)}
            subtitle={`${templatePerformance.summary.officeCount} office${templatePerformance.summary.officeCount === 1 ? '' : 's'} compared`}
            icon={<Activity className="h-5 w-5" />}
            iconBg="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
          />
          <SummaryCard
            label="Completion Rate"
            value={formatPercentValue(templatePerformance.summary.completionRate)}
            subtitle={`${templatePerformance.summary.templateCount} template group${templatePerformance.summary.templateCount === 1 ? '' : 's'}`}
            icon={<TicketCheck className="h-5 w-5" />}
            iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
          />
          <SummaryCard
            label="Avg Service Time"
            value={formatMinutesValue(templatePerformance.summary.avgServiceTime)}
            subtitle="serving to completed"
            icon={<Timer className="h-5 w-5" />}
            iconBg="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr,1.15fr]">
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h4 className="mb-4 text-sm font-semibold text-foreground">Business Type Comparison</h4>
            <TemplatePerformanceTable data={templatePerformance.templateRows} />
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h4 className="mb-4 text-sm font-semibold text-foreground">Location Comparison</h4>
            <TemplateOfficeComparisonTable data={templatePerformance.officeRows} />
          </div>
        </div>
      </section>

      {/* Charts Row 1: Tickets by Hour + Tickets by Department */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Busy hours today
          </h3>
          <TicketsByHourChart data={ticketsByHour} />
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Demand by department
          </h3>
          <DepartmentBarChart data={ticketsByDepartment} />
        </div>
      </div>

      {/* Charts Row 2: Wait Time Trend + Feedback Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Wait time trend
          </h3>
          <WaitTimeTrendChart data={waitTimeTrend} />
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <FeedbackDistribution data={feedbackSummary} />
        </div>
      </div>

      {/* Staff Performance Table */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          Team performance
        </h3>
        <StaffPerformanceTable data={staffPerformance} />
      </div>

      {/* Recent Feedback Comments */}
      {feedbackSummary.recentComments.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Recent customer comments
          </h3>
          <div className="space-y-3">
            {feedbackSummary.recentComments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-border bg-muted/30 p-4"
              >
                <div className="mb-1 flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i < c.rating
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.staff_name && `Staff: ${c.staff_name}`}
                    {c.service_name && ` | Service: ${c.service_name}`}
                  </span>
                </div>
                <p className="text-sm text-foreground">{c.comment}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'not yet';
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatPercentValue(value: number | null) {
  return value !== null ? `${value}%` : '--';
}

function formatMinutesValue(value: number | null) {
  return value !== null ? `${value} min` : '--';
}

function formatVerticalLabel(value: string) {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
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
    <div className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={`rounded-lg p-2 ${iconBg}`}>{icon}</div>
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
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

function TemplateActivityChart({ data }: { data: TemplateActivityPoint[] }) {
  const maxCount = Math.max(
    ...data.map((entry) => Math.max(entry.organizationUpgrades, entry.officeRollouts)),
    1
  );

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No template activity recorded for this range
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-56 items-end gap-2">
        {data.map((entry) => {
          const upgradePct = Math.max((entry.organizationUpgrades / maxCount) * 100, entry.organizationUpgrades > 0 ? 8 : 0);
          const rolloutPct = Math.max((entry.officeRollouts / maxCount) * 100, entry.officeRollouts > 0 ? 8 : 0);
          const dayLabel = new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });

          return (
            <div key={entry.date} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-full w-full items-end justify-center gap-1">
                <div
                  className="w-full max-w-5 rounded-t bg-violet-500/80"
                  style={{ height: `${upgradePct}%`, minHeight: entry.organizationUpgrades > 0 ? '10px' : '2px' }}
                  title={`${entry.organizationUpgrades} org upgrades`}
                />
                <div
                  className="w-full max-w-5 rounded-t bg-orange-500/80"
                  style={{ height: `${rolloutPct}%`, minHeight: entry.officeRollouts > 0 ? '10px' : '2px' }}
                  title={`${entry.officeRollouts} office rollouts`}
                />
              </div>
              <span className="text-center text-[10px] leading-tight text-muted-foreground">{dayLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          Organization upgrades
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          Office rollouts
        </span>
      </div>
    </div>
  );
}

function TemplateDriftTrendChart({
  data,
  scope,
}: {
  data: TemplateDriftTrendPoint[];
  scope: 'organization' | 'office';
}) {
  const maxDrift = Math.max(...data.map((entry) => entry.driftCount), 1);
  const hasRecordedSnapshots = data.some(
    (entry) => entry.driftCount > 0 || entry.coveragePercent > 0
  );

  if (data.length === 0 || !hasRecordedSnapshots) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No persistent drift snapshots recorded for this range yet
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-56 items-end gap-2">
        {data.map((entry) => {
          const driftPct = Math.max((entry.driftCount / maxDrift) * 100, entry.driftCount > 0 ? 8 : 0);
          const coveragePct = Math.max(entry.coveragePercent, entry.coveragePercent > 0 ? 8 : 0);
          const dayLabel = new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });

          return (
            <div key={entry.date} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex h-full w-full items-end justify-center gap-1">
                <div
                  className="w-full max-w-5 rounded-t bg-cyan-500/85"
                  style={{ height: `${driftPct}%`, minHeight: entry.driftCount > 0 ? '10px' : '2px' }}
                  title={`${entry.driftCount} ${scope} drift paths`}
                />
                <div
                  className="w-full max-w-5 rounded-t bg-emerald-500/70"
                  style={{ height: `${coveragePct}%`, minHeight: entry.coveragePercent > 0 ? '10px' : '2px' }}
                  title={`${entry.coveragePercent}% current version coverage`}
                />
              </div>
              <span className="text-center text-[10px] leading-tight text-muted-foreground">
                {dayLabel}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
          {scope === 'office' ? 'Office drift' : 'Organization drift'}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Current version coverage
        </span>
      </div>
    </div>
  );
}

function TemplateOfficeStatusTable({ data }: { data: TemplateHealthOfficeRow[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No office status data available
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.slice(0, 8).map((office) => (
        <div key={office.office_id} className="rounded-lg border border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{office.office_name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                v{office.applied_version} · Latest v{office.latest_version}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                office.is_current ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {office.is_current ? 'Current' : 'Behind'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{office.drift_count} drift paths</span>
            <span>{office.rollout_count} rollouts</span>
            <span>Last rollout {formatTimestamp(office.last_rolled_out_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplatePerformanceTable({ data }: { data: TemplatePerformanceRow[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No template KPI data available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-3 pr-4 font-medium text-muted-foreground">Template</th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">Tickets</th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">Wait Accuracy</th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">No-Show</th>
            <th className="pb-3 pr-4 text-right font-medium text-muted-foreground">Completion</th>
            <th className="pb-3 text-right font-medium text-muted-foreground">Avg Service</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr key={`${row.templateId}-${row.vertical}`} className="hover:bg-muted/30 transition-colors">
              <td className="py-3 pr-4">
                <p className="font-medium text-foreground">{row.templateTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatVerticalLabel(row.vertical)} · {row.officeCount} office{row.officeCount === 1 ? '' : 's'}
                </p>
              </td>
              <td className="py-3 pr-4 text-right text-foreground">{row.totalTickets}</td>
              <td className="py-3 pr-4 text-right text-foreground">{formatPercentValue(row.waitAccuracyPercent)}</td>
              <td className="py-3 pr-4 text-right text-foreground">{formatPercentValue(row.noShowRate)}</td>
              <td className="py-3 pr-4 text-right text-foreground">{formatPercentValue(row.completionRate)}</td>
              <td className="py-3 text-right text-foreground">{formatMinutesValue(row.avgServiceTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplateOfficeComparisonTable({ data }: { data: TemplateOfficeComparisonRow[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No office comparison data available
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {data.slice(0, 8).map((row) => (
        <div key={row.officeId} className="rounded-lg border border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{row.officeName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.templateTitle} · {formatVerticalLabel(row.vertical)}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
              {row.totalTickets} tickets
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
            <span>Wait accuracy {formatPercentValue(row.waitAccuracyPercent)}</span>
            <span>No-show {formatPercentValue(row.noShowRate)}</span>
            <span>Completion {formatPercentValue(row.completionRate)}</span>
            <span>Avg service {formatMinutesValue(row.avgServiceTime)}</span>
          </div>
        </div>
      ))}
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
