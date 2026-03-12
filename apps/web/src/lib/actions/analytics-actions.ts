'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Helper: get org_id from authenticated user ────────────────────────────

async function getOrgId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Not authenticated');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) throw new Error('Staff profile not found');

  return { supabase, orgId: staff.organization_id };
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

// ─── Date range helpers ────────────────────────────────────────────────────

function getDateRange(dateRange?: string): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (dateRange === 'last7') {
    start.setDate(start.getDate() - 6);
  } else if (dateRange === 'last30') {
    start.setDate(start.getDate() - 29);
  }
  // default: today

  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Analytics Summary ─────────────────────────────────────────────────────

export async function getAnalyticsSummary(
  officeId?: string,
  dateRange?: string
): Promise<AnalyticsSummary> {
  const { supabase, orgId } = await getOrgId();
  const { start, end } = getDateRange(dateRange);

  // Get offices for org to scope tickets
  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

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
  const { supabase, orgId } = await getOrgId();

  const targetDate = date ? new Date(date) : new Date();
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);

  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

  if (officeIds.length === 0) {
    return Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
  }

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at')
    .in('office_id', officeIds)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  const hourCounts = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: 0,
  }));

  (tickets ?? []).forEach((t: { created_at: string }) => {
    const hour = new Date(t.created_at).getHours();
    hourCounts[hour].count++;
  });

  return hourCounts;
}

// ─── Tickets By Department ─────────────────────────────────────────────────

export async function getTicketsByDepartment(
  officeId?: string,
  dateRange?: string
): Promise<DepartmentTicket[]> {
  const { supabase, orgId } = await getOrgId();
  const { start, end } = getDateRange(dateRange);

  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

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
  const { supabase, orgId } = await getOrgId();

  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

  if (officeIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select('created_at, serving_started_at')
    .in('office_id', officeIds)
    .not('serving_started_at', 'is', null)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  const dayMap = new Map<string, number[]>();

  // Initialize all days
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
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
  const { supabase, orgId } = await getOrgId();
  const { start, end } = getDateRange(dateRange);

  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

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
  const { supabase, orgId } = await getOrgId();
  const { start, end } = getDateRange(dateRange);

  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = officeId
    ? [officeId]
    : (offices ?? []).map((o: { id: string }) => o.id);

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
  const { supabase, orgId } = await getOrgId();

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office_id')
    .order('name');

  return {
    offices: offices ?? [],
    departments: departments ?? [],
  };
}
