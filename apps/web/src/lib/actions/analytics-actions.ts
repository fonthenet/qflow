'use server';

import { getStaffContext, requireAnalyticsAccess, type StaffContext } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { buildTemplateGovernanceReport } from '@/lib/platform/governance';
import { getOfficeDayStartIso, getOfficeDayEndIso } from '@/lib/office-day';

async function getAnalyticsContext() {
  const context = await getStaffContext();
  requireAnalyticsAccess(context);
  return context;
}

function getScopedOfficeIds(context: StaffContext, officeId?: string) {
  if (officeId) {
    if (!context.accessibleOfficeIds.includes(officeId)) {
      throw new Error('You do not have access to this office');
    }

    return [officeId];
  }

  return context.accessibleOfficeIds;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  totalTicketsToday: number;
  avgWaitTime: number | null;
  avgServiceTime: number | null;
  avgSatisfaction: number | null;
}

export interface HourlyTicket {
  hour: number;
  count: number;
}

export interface DepartmentTicket {
  department_id: string;
  department_name: string;
  count: number;
}

export interface WaitTimeTrend {
  date: string;
  avgWaitMinutes: number;
}

export interface StaffPerformanceRow {
  staff_id: string;
  staff_name: string;
  tickets_served: number;
  avg_service_time: number | null;
  avg_rating: number | null;
  no_show_count: number;
}

export interface FeedbackSummaryData {
  distribution: { rating: number; count: number }[];
  averageRating: number | null;
  totalFeedback: number;
  recentComments: {
    id: string;
    rating: number;
    comment: string;
    created_at: string;
    staff_name: string | null;
    service_name: string | null;
  }[];
}

export interface TemplateHealthSummaryData {
  templateId: string;
  templateTitle: string;
  appliedVersion: string;
  latestVersion: string;
  snapshotScope: 'organization' | 'office';
  officeCount: number;
  officesCurrentCount: number;
  officesBehindCount: number;
  officesWithDrift: number;
  currentDriftCount: number;
  currentVersionCoveragePercent: number;
  branchAlignmentPercent: number;
  organizationUpgradeCountInRange: number;
  officeRolloutCountInRange: number;
  driftSnapshotCountInRange: number;
  totalOrganizationUpgradeCount: number;
  totalOfficeRolloutCount: number;
  lastMigrationAt: string | null;
  lastOfficeRolloutAt: string | null;
}

export interface HourlyHeatmapCell {
  hour: number;
  dayOfWeek: number;
  count: number;
}

export interface ServiceBreakdownRow {
  service_id: string;
  service_name: string;
  ticket_count: number;
  avg_wait_minutes: number | null;
  avg_service_minutes: number | null;
  no_show_count: number;
}

export interface WeeklyTrendDay {
  date: string;
  total_tickets: number;
  avg_wait_minutes: number | null;
  avg_service_minutes: number | null;
  no_show_count: number;
}

export interface NoShowRateData {
  total_tickets: number;
  no_shows: number;
  rate: number;
}

export interface TemplateActivityPoint {
  date: string;
  organizationUpgrades: number;
  officeRollouts: number;
}

export interface TemplateHealthOfficeRow {
  office_id: string;
  office_name: string;
  applied_version: string;
  latest_version: string;
  is_current: boolean;
  drift_count: number;
  rollout_count: number;
  last_rolled_out_at: string | null;
}

export interface TemplateDriftTrendPoint {
  date: string;
  driftCount: number;
  coveragePercent: number;
}

export interface TemplateHealthAnalyticsData {
  summary: TemplateHealthSummaryData;
  activity: TemplateActivityPoint[];
  driftTrend: TemplateDriftTrendPoint[];
  officeStatuses: TemplateHealthOfficeRow[];
}

export interface TemplatePerformanceSummaryData {
  primaryTemplateId: string;
  primaryTemplateTitle: string;
  primaryVertical: string;
  templateCount: number;
  officeCount: number;
  totalTickets: number;
  waitAccuracyPercent: number | null;
  noShowRate: number | null;
  completionRate: number | null;
  avgServiceTime: number | null;
}

export interface TemplatePerformanceRow {
  templateId: string;
  templateTitle: string;
  vertical: string;
  officeCount: number;
  totalTickets: number;
  waitAccuracyPercent: number | null;
  noShowRate: number | null;
  completionRate: number | null;
  avgWaitTime: number | null;
  avgServiceTime: number | null;
}

export interface TemplateOfficeComparisonRow {
  officeId: string;
  officeName: string;
  templateId: string;
  templateTitle: string;
  vertical: string;
  totalTickets: number;
  waitAccuracyPercent: number | null;
  noShowRate: number | null;
  completionRate: number | null;
  avgWaitTime: number | null;
  avgServiceTime: number | null;
}

export interface TemplatePerformanceAnalyticsData {
  summary: TemplatePerformanceSummaryData;
  templateRows: TemplatePerformanceRow[];
  officeRows: TemplateOfficeComparisonRow[];
}

// ─── Timezone helper ──────────────────────────────────────────────────────

async function resolveTimezone(context: StaffContext, officeId?: string): Promise<string | undefined> {
  // Use org-level timezone as single source of truth — never per-office timezone
  const targetOfficeId = officeId || context.accessibleOfficeIds[0];
  if (!targetOfficeId) return undefined;
  const { data } = await context.supabase
    .from('offices')
    .select('organization:organizations(timezone)')
    .eq('id', targetOfficeId)
    .single();
  return (data as any)?.organization?.timezone ?? undefined;
}

/** Convert a UTC date to hour-of-day in the given timezone */
function getHourInTz(dateStr: string, tz?: string): number {
  if (!tz) return new Date(dateStr).getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).formatToParts(new Date(dateStr));
    return Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  } catch { return new Date(dateStr).getUTCHours(); }
}

/** Convert a UTC date to day-of-week (0=Sunday) in the given timezone.
 *  Uses dateKey approach for deterministic day resolution. */
function getDayInTz(dateStr: string, tz?: string): number {
  try {
    const d = new Date(dateStr);
    // Get YYYY-MM-DD in office timezone, then derive day from UTC noon
    const dateKey = tz
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
      : d.toISOString().split('T')[0];
    const noon = new Date(dateKey + 'T12:00:00Z');
    return noon.getUTCDay(); // 0=Sunday
  } catch {
    return new Date(dateStr).getUTCDay();
  }
}

// ─── Date range helpers ────────────────────────────────────────────────────

function getDateRange(dateRange?: string, timezone?: string): { start: string; end: string } {
  const todayStart = getOfficeDayStartIso(timezone);
  const todayEnd = getOfficeDayEndIso(timezone);

  if (!dateRange || dateRange === 'today') {
    return { start: todayStart, end: todayEnd };
  }

  // For multi-day ranges, shift the start backwards from today's start
  const startDate = new Date(todayStart);
  if (dateRange === 'last7') {
    startDate.setDate(startDate.getDate() - 6);
  } else if (dateRange === 'last30') {
    startDate.setDate(startDate.getDate() - 29);
  }

  return { start: startDate.toISOString(), end: todayEnd };
}

function isWithinRange(value: string | null, start: string, end: string) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return timestamp >= Date.parse(start) && timestamp <= Date.parse(end);
}

function getTimelineDays(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function getDriftCountForScope(
  snapshot: {
    organization_drift_count: number;
    office_drift_count: number;
  },
  scope: 'organization' | 'office'
) {
  return scope === 'organization' ? snapshot.organization_drift_count : snapshot.office_drift_count;
}

function roundMetric(value: number | null, digits: number = 1) {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

type TicketMetricRow = {
  office_id: string;
  created_at: string;
  serving_started_at: string | null;
  completed_at: string | null;
  estimated_wait_minutes: number | null;
  status: string;
};

type TemplateMetricAccumulator = {
  totalTickets: number;
  completedTickets: number;
  noShowTickets: number;
  waitMinutes: number[];
  serviceMinutes: number[];
  waitAccuracyScores: number[];
};

function createMetricAccumulator(): TemplateMetricAccumulator {
  return {
    totalTickets: 0,
    completedTickets: 0,
    noShowTickets: 0,
    waitMinutes: [],
    serviceMinutes: [],
    waitAccuracyScores: [],
  };
}

function appendTicketMetrics(accumulator: TemplateMetricAccumulator, ticket: TicketMetricRow) {
  accumulator.totalTickets += 1;

  if (ticket.status === 'no_show') {
    accumulator.noShowTickets += 1;
  }

  if (ticket.serving_started_at) {
    const actualWaitMinutes =
      (new Date(ticket.serving_started_at).getTime() - new Date(ticket.created_at).getTime()) / 60000;
    accumulator.waitMinutes.push(actualWaitMinutes);

    if (ticket.estimated_wait_minutes !== null) {
      const estimateBaseline = Math.max(ticket.estimated_wait_minutes, 5);
      const errorRatio = Math.abs(actualWaitMinutes - ticket.estimated_wait_minutes) / estimateBaseline;
      accumulator.waitAccuracyScores.push(Math.max(0, 100 - errorRatio * 100));
    }
  }

  if (ticket.serving_started_at && ticket.completed_at) {
    accumulator.completedTickets += 1;
    const serviceMinutes =
      (new Date(ticket.completed_at).getTime() - new Date(ticket.serving_started_at).getTime()) / 60000;
    accumulator.serviceMinutes.push(serviceMinutes);
  }
}

function finalizeMetricAccumulator(accumulator: TemplateMetricAccumulator) {
  return {
    totalTickets: accumulator.totalTickets,
    waitAccuracyPercent:
      accumulator.waitAccuracyScores.length > 0
        ? roundMetric(
            accumulator.waitAccuracyScores.reduce((total, score) => total + score, 0) /
              accumulator.waitAccuracyScores.length
          )
        : null,
    noShowRate:
      accumulator.totalTickets > 0
        ? roundMetric((accumulator.noShowTickets / accumulator.totalTickets) * 100)
        : null,
    completionRate:
      accumulator.totalTickets > 0
        ? roundMetric((accumulator.completedTickets / accumulator.totalTickets) * 100)
        : null,
    avgWaitTime:
      accumulator.waitMinutes.length > 0
        ? roundMetric(
            accumulator.waitMinutes.reduce((total, value) => total + value, 0) /
              accumulator.waitMinutes.length
          )
        : null,
    avgServiceTime:
      accumulator.serviceMinutes.length > 0
        ? roundMetric(
            accumulator.serviceMinutes.reduce((total, value) => total + value, 0) /
              accumulator.serviceMinutes.length
          )
        : null,
  };
}

function buildDriftTrend(input: {
  start: string;
  end: string;
  scope: 'organization' | 'office';
  snapshots: {
    created_at: string;
    organization_drift_count: number;
    office_drift_count: number;
    current_version_coverage_percent: number;
  }[];
  baselineSnapshot?: {
    created_at: string;
    organization_drift_count: number;
    office_drift_count: number;
    current_version_coverage_percent: number;
  } | null;
}): TemplateDriftTrendPoint[] {
  const snapshotsByDate = new Map<string, (typeof input.snapshots)[number]>();

  for (const snapshot of input.snapshots) {
    snapshotsByDate.set(snapshot.created_at.split('T')[0], snapshot);
  }

  let driftCount = input.baselineSnapshot
    ? getDriftCountForScope(input.baselineSnapshot, input.scope)
    : 0;
  let coveragePercent = input.baselineSnapshot?.current_version_coverage_percent ?? 0;

  return getTimelineDays(input.start, input.end).map((date) => {
    const snapshot = snapshotsByDate.get(date);

    if (snapshot) {
      driftCount = getDriftCountForScope(snapshot, input.scope);
      coveragePercent = snapshot.current_version_coverage_percent;
    }

    return {
      date,
      driftCount,
      coveragePercent,
    };
  });
}

// ─── Analytics Summary ─────────────────────────────────────────────────────

export async function getAnalyticsSummary(
  officeId?: string,
  dateRange?: string
): Promise<AnalyticsSummary> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) {
    return {
      totalTicketsToday: 0,
      avgWaitTime: null,
      avgServiceTime: null,
      avgSatisfaction: null,
    };
  }

  // Total tickets
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, created_at, serving_started_at, completed_at, status, office_id')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  const allTickets = tickets ?? [];
  const totalTicketsToday = allTickets.length;

  // Average wait time (created_at -> serving_started_at) for served/completed tickets
  const servedTickets = allTickets.filter(
    (t) => t.serving_started_at && t.created_at
  );
  let avgWaitTime: number | null = null;
  if (servedTickets.length > 0) {
    const totalWait = servedTickets.reduce((acc, t) => {
      const wait =
        new Date(t.serving_started_at).getTime() -
        new Date(t.created_at).getTime();
      return acc + wait;
    }, 0);
    avgWaitTime = Math.round(totalWait / servedTickets.length / 60000); // minutes
  }

  // Average service time (serving_started_at -> completed_at) for completed tickets
  const completedTickets = allTickets.filter(
    (t) => t.serving_started_at && t.completed_at
  );
  let avgServiceTime: number | null = null;
  if (completedTickets.length > 0) {
    const totalService = completedTickets.reduce((acc, t) => {
      const service =
        new Date(t.completed_at).getTime() -
        new Date(t.serving_started_at).getTime();
      return acc + service;
    }, 0);
    avgServiceTime = Math.round(totalService / completedTickets.length / 60000);
  }

  // Average satisfaction from feedback
  const { data: feedback } = await supabase
    .from('feedback')
    .select('rating, ticket:tickets!inner(office_id, created_at)')
    .in('ticket.office_id', officeIds)
    .gte('ticket.created_at', start)
    .lte('ticket.created_at', end);

  let avgSatisfaction: number | null = null;
  if (feedback && feedback.length > 0) {
    const totalRating = feedback.reduce(
      (acc: number, f: { rating: number }) => acc + f.rating,
      0
    );
    avgSatisfaction = Math.round((totalRating / feedback.length) * 10) / 10;
  }

  return { totalTicketsToday, avgWaitTime, avgServiceTime, avgSatisfaction };
}

// ─── Tickets By Hour ───────────────────────────────────────────────────────

export async function getTicketsByHour(
  officeId?: string,
  date?: string
): Promise<HourlyTicket[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);

  // Use timezone-aware day boundaries (today or a specific date)
  const { start, end } = getDateRange(undefined, tz);

  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) {
    return Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
  }

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  const hourCounts = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: 0,
  }));

  (tickets ?? []).forEach((t: { created_at: string }) => {
    const hour = getHourInTz(t.created_at, tz);
    hourCounts[hour].count++;
  });

  return hourCounts;
}

// ─── Tickets By Department ─────────────────────────────────────────────────

export async function getTicketsByDepartment(
  officeId?: string,
  dateRange?: string
): Promise<DepartmentTicket[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('department_id, department:departments(name)')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  const deptMap = new Map<string, { name: string; count: number }>();

  (tickets ?? []).forEach((t: any) => {
    const deptId = t.department_id;
    if (!deptId) return;
    const existing = deptMap.get(deptId);
    if (existing) {
      existing.count++;
    } else {
      deptMap.set(deptId, {
        name: t.department?.name ?? 'Unknown',
        count: 1,
      });
    }
  });

  return Array.from(deptMap.entries())
    .map(([department_id, { name, count }]) => ({
      department_id,
      department_name: name,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Wait Time Trend ───────────────────────────────────────────────────────

export async function getWaitTimeTrend(
  officeId?: string,
  days: number = 7
): Promise<WaitTimeTrend[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);

  const endIso = getOfficeDayEndIso(tz);
  const startDate = new Date(getOfficeDayStartIso(tz));
  startDate.setDate(startDate.getDate() - (days - 1));
  const start = startDate.toISOString();
  const end = endIso;

  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at, serving_started_at')
    .in('office_id', officeIds)
    .not('serving_started_at', 'is', null)
    .gte('created_at', start)
    .lte('created_at', end);

  const dayMap = new Map<string, number[]>();

  // Initialize all days
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const key = d.toISOString().split('T')[0];
    dayMap.set(key, []);
  }

  (tickets ?? []).forEach((t: any) => {
    const dateKey = new Date(t.created_at).toISOString().split('T')[0];
    const waitMs =
      new Date(t.serving_started_at).getTime() -
      new Date(t.created_at).getTime();
    const waitMin = waitMs / 60000;
    const arr = dayMap.get(dateKey);
    if (arr) arr.push(waitMin);
  });

  return Array.from(dayMap.entries())
    .map(([date, waits]) => ({
      date,
      avgWaitMinutes:
        waits.length > 0
          ? Math.round(
              (waits.reduce((a, b) => a + b, 0) / waits.length) * 10
            ) / 10
          : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Staff Performance ─────────────────────────────────────────────────────

export async function getStaffPerformance(
  officeId?: string,
  dateRange?: string
): Promise<StaffPerformanceRow[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) return [];

  // Get all tickets with staff assignment
  const { data: tickets } = await supabase
    .from('tickets')
    .select(
      'id, status, serving_started_at, completed_at, served_by, staff:staff!tickets_served_by_fkey(full_name)'
    )
    .in('office_id', officeIds)
    .not('served_by', 'is', null)
    .gte('created_at', start)
    .lte('created_at', end);

  // Get feedback keyed by ticket
  const { data: feedback } = await supabase
    .from('feedback')
    .select('ticket_id, rating')
    .in(
      'ticket_id',
      (tickets ?? []).map((t: any) => t.id)
    );

  const feedbackMap = new Map<string, number[]>();
  (feedback ?? []).forEach((f: { ticket_id: string; rating: number }) => {
    const arr = feedbackMap.get(f.ticket_id) ?? [];
    arr.push(f.rating);
    feedbackMap.set(f.ticket_id, arr);
  });

  // Group by staff
  const staffMap = new Map<
    string,
    {
      name: string;
      served: number;
      serviceTimes: number[];
      ratings: number[];
      noShows: number;
    }
  >();

  (tickets ?? []).forEach((t: any) => {
    const staffId = t.served_by;
    if (!staffId) return;

    if (!staffMap.has(staffId)) {
      staffMap.set(staffId, {
        name: t.staff?.full_name ?? 'Unknown',
        served: 0,
        serviceTimes: [],
        ratings: [],
        noShows: 0,
      });
    }

    const entry = staffMap.get(staffId)!;

    if (t.status === 'no_show') {
      entry.noShows++;
    } else {
      entry.served++;
    }

    if (t.serving_started_at && t.completed_at) {
      const serviceMs =
        new Date(t.completed_at).getTime() -
        new Date(t.serving_started_at).getTime();
      entry.serviceTimes.push(serviceMs / 60000);
    }

    const ticketRatings = feedbackMap.get(t.id);
    if (ticketRatings) {
      entry.ratings.push(...ticketRatings);
    }
  });

  return Array.from(staffMap.entries())
    .map(([staff_id, data]) => ({
      staff_id,
      staff_name: data.name,
      tickets_served: data.served,
      avg_service_time:
        data.serviceTimes.length > 0
          ? Math.round(
              (data.serviceTimes.reduce((a, b) => a + b, 0) /
                data.serviceTimes.length) *
                10
            ) / 10
          : null,
      avg_rating:
        data.ratings.length > 0
          ? Math.round(
              (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length) *
                10
            ) / 10
          : null,
      no_show_count: data.noShows,
    }))
    .sort((a, b) => b.tickets_served - a.tickets_served);
}

// ─── Feedback Summary ──────────────────────────────────────────────────────

export async function getFeedbackSummary(
  officeId?: string,
  dateRange?: string
): Promise<FeedbackSummaryData> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) {
    return {
      distribution: [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: 0 })),
      averageRating: null,
      totalFeedback: 0,
      recentComments: [],
    };
  }

  const { data: feedback } = await supabase
    .from('feedback')
    .select(
      '*, staff:staff(full_name), service:services(name), ticket:tickets!inner(office_id, created_at)'
    )
    .in('ticket.office_id', officeIds)
    .gte('ticket.created_at', start)
    .lte('ticket.created_at', end)
    .order('created_at', { ascending: false });

  const allFeedback = feedback ?? [];

  // Distribution
  const distMap = new Map<number, number>();
  for (let i = 1; i <= 5; i++) distMap.set(i, 0);
  allFeedback.forEach((f: any) => {
    distMap.set(f.rating, (distMap.get(f.rating) ?? 0) + 1);
  });

  const distribution = Array.from(distMap.entries())
    .map(([rating, count]) => ({ rating, count }))
    .sort((a, b) => a.rating - b.rating);

  const totalFeedback = allFeedback.length;
  const averageRating =
    totalFeedback > 0
      ? Math.round(
          (allFeedback.reduce((acc: number, f: any) => acc + f.rating, 0) /
            totalFeedback) *
            10
        ) / 10
      : null;

  const recentComments = allFeedback
    .filter((f: any) => f.comment)
    .slice(0, 10)
    .map((f: any) => ({
      id: f.id,
      rating: f.rating,
      comment: f.comment,
      created_at: f.created_at,
      staff_name: f.staff?.full_name ?? null,
      service_name: f.service?.name ?? null,
    }));

  return { distribution, averageRating, totalFeedback, recentComments };
}

// ─── Offices and Departments for filters ───────────────────────────────────

export async function getFilterOptions() {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const officeIds = getScopedOfficeIds(context);

  const { data: offices } = officeIds.length > 0
    ? await supabase
        .from('offices')
        .select('id, name')
        .in('id', officeIds)
        .eq('is_active', true)
        .order('name')
    : { data: [] };

  const { data: departments } = officeIds.length > 0
    ? await supabase
        .from('departments')
        .select('id, name, office_id')
        .in('office_id', officeIds)
        .order('name')
    : { data: [] };

  return {
    offices: offices ?? [],
    departments: departments ?? [],
  };
}

export async function getTemplateHealthAnalytics(
  officeId?: string,
  dateRange?: string
): Promise<TemplateHealthAnalyticsData> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const officeIds = getScopedOfficeIds(context, officeId);
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const snapshotScope = officeId ? 'office' : 'organization';

  if (officeIds.length === 0) {
    return {
      summary: {
        templateId: 'public-service-standard',
        templateTitle: 'Qflo Template',
        appliedVersion: '1.0.0',
        latestVersion: '1.0.0',
        snapshotScope,
        officeCount: 0,
        officesCurrentCount: 0,
        officesBehindCount: 0,
        officesWithDrift: 0,
        currentDriftCount: 0,
        currentVersionCoveragePercent: 0,
        branchAlignmentPercent: 0,
        organizationUpgradeCountInRange: 0,
        officeRolloutCountInRange: 0,
        driftSnapshotCountInRange: 0,
        totalOrganizationUpgradeCount: 0,
        totalOfficeRolloutCount: 0,
        lastMigrationAt: null,
        lastOfficeRolloutAt: null,
      },
      activity: getTimelineDays(start, end).map((date) => ({
        date,
        organizationUpgrades: 0,
        officeRollouts: 0,
      })),
      driftTrend: getTimelineDays(start, end).map((date) => ({
        date,
        driftCount: 0,
        coveragePercent: 0,
      })),
      officeStatuses: [],
    };
  }

  let snapshotRangeQuery = supabase
    .from('template_health_snapshots')
    .select(
      'created_at, organization_drift_count, office_drift_count, current_version_coverage_percent'
    )
    .eq('organization_id', context.staff.organization_id)
    .eq('snapshot_scope', snapshotScope)
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: true });

  let snapshotBaselineQuery = supabase
    .from('template_health_snapshots')
    .select(
      'created_at, organization_drift_count, office_drift_count, current_version_coverage_percent'
    )
    .eq('organization_id', context.staff.organization_id)
    .eq('snapshot_scope', snapshotScope)
    .lt('created_at', start)
    .order('created_at', { ascending: false })
    .limit(1);

  if (officeId) {
    snapshotRangeQuery = snapshotRangeQuery.eq('office_id', officeId);
    snapshotBaselineQuery = snapshotBaselineQuery.eq('office_id', officeId);
  }

  const [
    { data: organization, error: organizationError },
    { data: offices, error: officesError },
    snapshotRangeResult,
    snapshotBaselineResult,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('settings')
      .eq('id', context.staff.organization_id)
      .single(),
    supabase
      .from('offices')
      .select('id, name, settings')
      .in('id', officeIds)
      .order('name'),
    snapshotRangeQuery,
    snapshotBaselineQuery,
  ]);

  if (organizationError) {
    throw new Error(organizationError.message);
  }

  if (officesError) {
    throw new Error(officesError.message);
  }

  const snapshotRows =
    snapshotRangeResult.error || !snapshotRangeResult.data ? [] : snapshotRangeResult.data;
  const baselineSnapshot =
    snapshotBaselineResult.error || !snapshotBaselineResult.data
      ? null
      : snapshotBaselineResult.data[0] ?? null;

  const governanceReport = buildTemplateGovernanceReport({
    organizationSettings: organization?.settings ?? {},
    offices: offices ?? [],
  });

  const organizationUpgradeCountInRange = governanceReport.migrationHistory.filter((entry) =>
    isWithinRange(entry.appliedAt, start, end)
  ).length;
  const officeRolloutCountInRange = governanceReport.officeRolloutHistory.filter((entry) =>
    isWithinRange(entry.rolledOutAt, start, end)
  ).length;

  const activityByDate = new Map<string, TemplateActivityPoint>(
    getTimelineDays(start, end).map((date) => [
      date,
      {
        date,
        organizationUpgrades: 0,
        officeRollouts: 0,
      },
    ])
  );

  for (const entry of governanceReport.migrationHistory) {
    if (!isWithinRange(entry.appliedAt, start, end)) {
      continue;
    }

    const date = entry.appliedAt.split('T')[0];
    const current = activityByDate.get(date);
    if (current) {
      current.organizationUpgrades += 1;
    }
  }

  for (const entry of governanceReport.officeRolloutHistory) {
    if (!isWithinRange(entry.rolledOutAt, start, end)) {
      continue;
    }

    const date = entry.rolledOutAt.split('T')[0];
    const current = activityByDate.get(date);
    if (current) {
      current.officeRollouts += 1;
    }
  }

  const currentDriftCount = officeId
    ? governanceReport.officeReports[0]?.driftCount ?? 0
    : governanceReport.organizationDriftCount;
  const driftTrend = buildDriftTrend({
    start,
    end,
    scope: snapshotScope,
    snapshots: snapshotRows,
    baselineSnapshot,
  });

  return {
    summary: {
      templateId: governanceReport.templateId,
      templateTitle: governanceReport.templateTitle,
      appliedVersion: governanceReport.appliedVersion,
      latestVersion: governanceReport.latestVersion,
      snapshotScope,
      officeCount: governanceReport.healthSummary.officeCount,
      officesCurrentCount: governanceReport.healthSummary.officesCurrentCount,
      officesBehindCount: governanceReport.healthSummary.officesBehindCount,
      officesWithDrift: governanceReport.healthSummary.officesWithDrift,
      currentDriftCount,
      currentVersionCoveragePercent: governanceReport.healthSummary.currentVersionCoveragePercent,
      branchAlignmentPercent: governanceReport.healthSummary.branchAlignmentPercent,
      organizationUpgradeCountInRange,
      officeRolloutCountInRange,
      driftSnapshotCountInRange: snapshotRows.length,
      totalOrganizationUpgradeCount: governanceReport.healthSummary.organizationMigrationCount,
      totalOfficeRolloutCount: governanceReport.healthSummary.officeRolloutCount,
      lastMigrationAt: governanceReport.healthSummary.lastMigrationAt,
      lastOfficeRolloutAt: governanceReport.healthSummary.lastOfficeRolloutAt,
    },
    activity: Array.from(activityByDate.values()).sort((left, right) => left.date.localeCompare(right.date)),
    driftTrend,
    officeStatuses: governanceReport.officeReports.map((office) => ({
      office_id: office.officeId,
      office_name: office.officeName,
      applied_version: office.appliedVersion,
      latest_version: office.latestVersion,
      is_current: !office.isUpgradeAvailable,
      drift_count: office.driftCount,
      rollout_count: office.rolloutCount,
      last_rolled_out_at: office.lastRolledOutAt,
    })),
  };
}

export async function getTemplatePerformanceAnalytics(
  officeId?: string,
  dateRange?: string
): Promise<TemplatePerformanceAnalyticsData> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const officeIds = getScopedOfficeIds(context, officeId);
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);

  if (officeIds.length === 0) {
    return {
      summary: {
        primaryTemplateId: 'public-service-standard',
        primaryTemplateTitle: 'Qflo Template',
        primaryVertical: 'public_service',
        templateCount: 0,
        officeCount: 0,
        totalTickets: 0,
        waitAccuracyPercent: null,
        noShowRate: null,
        completionRate: null,
        avgServiceTime: null,
      },
      templateRows: [],
      officeRows: [],
    };
  }

  const [{ data: organization, error: organizationError }, { data: offices, error: officesError }, { data: tickets, error: ticketsError }] =
    await Promise.all([
      supabase
        .from('organizations')
        .select('settings')
        .eq('id', context.staff.organization_id)
        .single(),
      supabase
        .from('offices')
        .select('id, name, settings')
        .in('id', officeIds)
        .order('name'),
      supabase
        .from('tickets')
        .select('office_id, created_at, serving_started_at, completed_at, estimated_wait_minutes, status')
        .in('office_id', officeIds)
        .gte('created_at', start)
        .lte('created_at', end),
    ]);

  if (organizationError) {
    throw new Error(organizationError.message);
  }

  if (officesError) {
    throw new Error(officesError.message);
  }

  if (ticketsError) {
    throw new Error(ticketsError.message);
  }

  const organizationSettings = organization?.settings ?? {};
  const officeMap = new Map(
    (offices ?? []).map((office) => {
      const resolved = resolvePlatformConfig({
        organizationSettings,
        officeSettings: office.settings ?? {},
      });

      return [
        office.id,
        {
          officeId: office.id,
          officeName: office.name,
          templateId: resolved.template.id,
          templateTitle: resolved.template.title,
          vertical: resolved.selection.vertical,
        },
      ];
    })
  );

  const officeAccumulators = new Map<string, TemplateMetricAccumulator>();
  const templateAccumulators = new Map<
    string,
    {
      templateId: string;
      templateTitle: string;
      vertical: string;
      officeIds: Set<string>;
      metrics: TemplateMetricAccumulator;
    }
  >();
  const overallAccumulator = createMetricAccumulator();

  for (const ticket of (tickets ?? []) as TicketMetricRow[]) {
    const office = officeMap.get(ticket.office_id);
    if (!office) {
      continue;
    }

    appendTicketMetrics(overallAccumulator, ticket);

    const officeAccumulator = officeAccumulators.get(office.officeId) ?? createMetricAccumulator();
    appendTicketMetrics(officeAccumulator, ticket);
    officeAccumulators.set(office.officeId, officeAccumulator);

    const templateKey = `${office.templateId}:${office.vertical}`;
    const templateEntry =
      templateAccumulators.get(templateKey) ??
      {
        templateId: office.templateId,
        templateTitle: office.templateTitle,
        vertical: office.vertical,
        officeIds: new Set<string>(),
        metrics: createMetricAccumulator(),
      };

    templateEntry.officeIds.add(office.officeId);
    appendTicketMetrics(templateEntry.metrics, ticket);
    templateAccumulators.set(templateKey, templateEntry);
  }

  const officeRows = Array.from(officeMap.values())
    .map((office) => {
      const metrics = finalizeMetricAccumulator(
        officeAccumulators.get(office.officeId) ?? createMetricAccumulator()
      );

      return {
        officeId: office.officeId,
        officeName: office.officeName,
        templateId: office.templateId,
        templateTitle: office.templateTitle,
        vertical: office.vertical,
        totalTickets: metrics.totalTickets,
        waitAccuracyPercent: metrics.waitAccuracyPercent,
        noShowRate: metrics.noShowRate,
        completionRate: metrics.completionRate,
        avgWaitTime: metrics.avgWaitTime,
        avgServiceTime: metrics.avgServiceTime,
      };
    })
    .sort((left, right) => right.totalTickets - left.totalTickets || left.officeName.localeCompare(right.officeName));

  const templateRows = Array.from(templateAccumulators.values())
    .map((entry) => {
      const metrics = finalizeMetricAccumulator(entry.metrics);

      return {
        templateId: entry.templateId,
        templateTitle: entry.templateTitle,
        vertical: entry.vertical,
        officeCount: entry.officeIds.size,
        totalTickets: metrics.totalTickets,
        waitAccuracyPercent: metrics.waitAccuracyPercent,
        noShowRate: metrics.noShowRate,
        completionRate: metrics.completionRate,
        avgWaitTime: metrics.avgWaitTime,
        avgServiceTime: metrics.avgServiceTime,
      };
    })
    .sort((left, right) => right.totalTickets - left.totalTickets || left.templateTitle.localeCompare(right.templateTitle));

  const overallMetrics = finalizeMetricAccumulator(overallAccumulator);
  const primaryRow = templateRows[0];
  const fallbackOffice = Array.from(officeMap.values())[0];

  return {
    summary: {
      primaryTemplateId: primaryRow?.templateId ?? fallbackOffice?.templateId ?? 'public-service-standard',
      primaryTemplateTitle: primaryRow?.templateTitle ?? fallbackOffice?.templateTitle ?? 'Qflo Template',
      primaryVertical: primaryRow?.vertical ?? fallbackOffice?.vertical ?? 'public_service',
      templateCount: templateRows.length,
      officeCount: officeMap.size,
      totalTickets: overallMetrics.totalTickets,
      waitAccuracyPercent: overallMetrics.waitAccuracyPercent,
      noShowRate: overallMetrics.noShowRate,
      completionRate: overallMetrics.completionRate,
      avgServiceTime: overallMetrics.avgServiceTime,
    },
    templateRows,
    officeRows,
  };
}

// ─── Hourly Heatmap ──────────────────────────────────────────────────────

export async function getHourlyHeatmap(
  officeId?: string,
  dateRange?: string
): Promise<HourlyHeatmapCell[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  // Initialize grid: 24 hours x 7 days
  const grid: HourlyHeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      grid.push({ hour, dayOfWeek: dow, count: 0 });
    }
  }

  if (officeIds.length === 0) return grid;

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  (tickets ?? []).forEach((t: { created_at: string }) => {
    const dow = getDayInTz(t.created_at, tz); // 0=Sunday, in org timezone
    const hour = getHourInTz(t.created_at, tz);
    const cell = grid.find((c) => c.dayOfWeek === dow && c.hour === hour);
    if (cell) cell.count++;
  });

  return grid;
}

// ─── Service Breakdown ───────────────────────────────────────────────────

export async function getServiceBreakdown(
  officeId?: string,
  dateRange?: string
): Promise<ServiceBreakdownRow[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('service_id, status, created_at, serving_started_at, completed_at, service:services(name)')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  const serviceMap = new Map<
    string,
    {
      name: string;
      count: number;
      noShows: number;
      waitMinutes: number[];
      serviceMinutes: number[];
    }
  >();

  (tickets ?? []).forEach((t: any) => {
    const svcId = t.service_id;
    if (!svcId) return;

    let entry = serviceMap.get(svcId);
    if (!entry) {
      entry = {
        name: t.service?.name ?? 'Unknown',
        count: 0,
        noShows: 0,
        waitMinutes: [],
        serviceMinutes: [],
      };
      serviceMap.set(svcId, entry);
    }

    entry.count++;

    if (t.status === 'no_show') {
      entry.noShows++;
    }

    if (t.serving_started_at && t.created_at) {
      const waitMs =
        new Date(t.serving_started_at).getTime() - new Date(t.created_at).getTime();
      entry.waitMinutes.push(waitMs / 60000);
    }

    if (t.serving_started_at && t.completed_at) {
      const serviceMs =
        new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime();
      entry.serviceMinutes.push(serviceMs / 60000);
    }
  });

  return Array.from(serviceMap.entries())
    .map(([service_id, entry]) => ({
      service_id,
      service_name: entry.name,
      ticket_count: entry.count,
      avg_wait_minutes:
        entry.waitMinutes.length > 0
          ? roundMetric(
              entry.waitMinutes.reduce((a, b) => a + b, 0) / entry.waitMinutes.length
            )
          : null,
      avg_service_minutes:
        entry.serviceMinutes.length > 0
          ? roundMetric(
              entry.serviceMinutes.reduce((a, b) => a + b, 0) / entry.serviceMinutes.length
            )
          : null,
      no_show_count: entry.noShows,
    }))
    .sort((a, b) => b.ticket_count - a.ticket_count);
}

// ─── Weekly Trends ───────────────────────────────────────────────────────

export async function getWeeklyTrends(
  officeId?: string,
  dateRange?: string
): Promise<WeeklyTrendDay[]> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);

  // Always use last 30 days for weekly trends
  const endIso = getOfficeDayEndIso(tz);
  const startDate = new Date(getOfficeDayStartIso(tz));
  startDate.setDate(startDate.getDate() - 29);
  const start = startDate.toISOString();
  const end = endIso;

  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at, serving_started_at, completed_at, status')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  // Initialize all 30 days
  const dayMap = new Map<
    string,
    {
      total: number;
      noShows: number;
      waitMinutes: number[];
      serviceMinutes: number[];
    }
  >();

  for (let i = 0; i < 30; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dayMap.set(d.toISOString().split('T')[0], {
      total: 0,
      noShows: 0,
      waitMinutes: [],
      serviceMinutes: [],
    });
  }

  (tickets ?? []).forEach((t: any) => {
    const dateKey = new Date(t.created_at).toISOString().split('T')[0];
    const entry = dayMap.get(dateKey);
    if (!entry) return;

    entry.total++;

    if (t.status === 'no_show') {
      entry.noShows++;
    }

    if (t.serving_started_at) {
      const waitMs =
        new Date(t.serving_started_at).getTime() - new Date(t.created_at).getTime();
      entry.waitMinutes.push(waitMs / 60000);
    }

    if (t.serving_started_at && t.completed_at) {
      const serviceMs =
        new Date(t.completed_at).getTime() - new Date(t.serving_started_at).getTime();
      entry.serviceMinutes.push(serviceMs / 60000);
    }
  });

  return Array.from(dayMap.entries())
    .map(([date, entry]) => ({
      date,
      total_tickets: entry.total,
      avg_wait_minutes:
        entry.waitMinutes.length > 0
          ? roundMetric(
              entry.waitMinutes.reduce((a, b) => a + b, 0) / entry.waitMinutes.length
            )
          : null,
      avg_service_minutes:
        entry.serviceMinutes.length > 0
          ? roundMetric(
              entry.serviceMinutes.reduce((a, b) => a + b, 0) / entry.serviceMinutes.length
            )
          : null,
      no_show_count: entry.noShows,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── No-Show Rate ────────────────────────────────────────────────────────

export async function getNoShowRate(
  officeId?: string,
  dateRange?: string
): Promise<NoShowRateData> {
  const context = await getAnalyticsContext();
  const { supabase } = context;
  const tz = await resolveTimezone(context, officeId);
  const { start, end } = getDateRange(dateRange, tz);
  const officeIds = getScopedOfficeIds(context, officeId);

  if (officeIds.length === 0) {
    return { total_tickets: 0, no_shows: 0, rate: 0 };
  }

  const { data: tickets } = await supabase
    .from('tickets')
    .select('status')
    .in('office_id', officeIds)
    .gte('created_at', start)
    .lte('created_at', end);

  const allTickets = tickets ?? [];
  const total_tickets = allTickets.length;
  const no_shows = allTickets.filter((t: { status: string }) => t.status === 'no_show').length;
  const rate = total_tickets > 0 ? roundMetric((no_shows / total_tickets) * 100) ?? 0 : 0;

  return { total_tickets, no_shows, rate };
}
