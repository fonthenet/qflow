import { redirect } from 'next/navigation';
import { getStaffContext, requireAnalyticsAccess } from '@/lib/authz';
import {
  getAnalyticsSummary,
  getTicketsByHour,
  getTicketsByDepartment,
  getWaitTimeTrend,
  getStaffPerformance,
  getFeedbackSummary,
  getFilterOptions,
  getTemplateHealthAnalytics,
  getTemplatePerformanceAnalytics,
  getHourlyHeatmap,
  getServiceBreakdown,
  getWeeklyTrends,
  getNoShowRate,
} from '@/lib/actions/analytics-actions';
import { AnalyticsDashboard } from './analytics-dashboard';

export default async function AnalyticsPage() {
  const context = await getStaffContext();
  try {
    requireAnalyticsAccess(context);
  } catch {
    redirect('/desk');
  }

  const [
    summary,
    ticketsByHour,
    ticketsByDepartment,
    waitTimeTrend,
    staffPerformance,
    feedbackSummary,
    templateHealth,
    templatePerformance,
    hourlyHeatmap,
    serviceBreakdown,
    weeklyTrends,
    noShowRate,
    filterOptions,
  ] = await Promise.all([
    getAnalyticsSummary(),
    getTicketsByHour(),
    getTicketsByDepartment(),
    getWaitTimeTrend(),
    getStaffPerformance(),
    getFeedbackSummary(),
    getTemplateHealthAnalytics(),
    getTemplatePerformanceAnalytics(),
    getHourlyHeatmap(),
    getServiceBreakdown(),
    getWeeklyTrends(),
    getNoShowRate(),
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
      initialTemplateHealth={templateHealth}
      initialTemplatePerformance={templatePerformance}
      initialHourlyHeatmap={hourlyHeatmap}
      initialServiceBreakdown={serviceBreakdown}
      initialWeeklyTrends={weeklyTrends}
      initialNoShowRate={noShowRate}
      offices={filterOptions.offices}
      departments={filterOptions.departments}
    />
  );
}
