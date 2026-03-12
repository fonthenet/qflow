import { createClient } from '@/lib/supabase/server';
import {
  getAnalyticsSummary,
  getTicketsByHour,
  getTicketsByDepartment,
  getWaitTimeTrend,
  getStaffPerformance,
  getFeedbackSummary,
  getFilterOptions,
} from '@/lib/actions/analytics-actions';
import { AnalyticsDashboard } from './analytics-dashboard';

export default async function AnalyticsPage() {
  const [
    summary,
    ticketsByHour,
    ticketsByDepartment,
    waitTimeTrend,
    staffPerformance,
    feedbackSummary,
    filterOptions,
  ] = await Promise.all([
    getAnalyticsSummary(),
    getTicketsByHour(),
    getTicketsByDepartment(),
    getWaitTimeTrend(),
    getStaffPerformance(),
    getFeedbackSummary(),
    getFilterOptions(),
  ]);

  return (
    <AnalyticsDashboard
      initialSummary={summary}
      initialTicketsByHour={ticketsByHour}
      initialTicketsByDepartment={ticketsByDepartment}
      initialWaitTimeTrend={waitTimeTrend}
      initialStaffPerformance={staffPerformance}
      initialFeedbackSummary={feedbackSummary}
      offices={filterOptions.offices}
      departments={filterOptions.departments}
    />
  );
}
