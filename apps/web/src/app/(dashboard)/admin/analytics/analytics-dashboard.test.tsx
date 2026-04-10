// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalyticsSummary,
  DepartmentTicket,
  FeedbackSummaryData,
  HourlyTicket,
  HourlyHeatmapCell,
  ServiceBreakdownRow,
  WeeklyTrendDay,
  NoShowRateData,
  StaffPerformanceRow,
  TemplateHealthAnalyticsData,
  TemplatePerformanceAnalyticsData,
  WaitTimeTrend,
} from '@/lib/actions/analytics-actions';
import { LocaleProvider } from '@/components/providers/locale-provider';

const {
  getAnalyticsSummaryMock,
  getTicketsByHourMock,
  getTicketsByDepartmentMock,
  getWaitTimeTrendMock,
  getStaffPerformanceMock,
  getFeedbackSummaryMock,
  getTemplateHealthAnalyticsMock,
  getTemplatePerformanceAnalyticsMock,
  getHourlyHeatmapMock,
  getServiceBreakdownMock,
  getWeeklyTrendsMock,
  getNoShowRateMock,
} = vi.hoisted(() => ({
  getAnalyticsSummaryMock: vi.fn(),
  getTicketsByHourMock: vi.fn(),
  getTicketsByDepartmentMock: vi.fn(),
  getWaitTimeTrendMock: vi.fn(),
  getStaffPerformanceMock: vi.fn(),
  getFeedbackSummaryMock: vi.fn(),
  getTemplateHealthAnalyticsMock: vi.fn(),
  getTemplatePerformanceAnalyticsMock: vi.fn(),
  getHourlyHeatmapMock: vi.fn(),
  getServiceBreakdownMock: vi.fn(),
  getWeeklyTrendsMock: vi.fn(),
  getNoShowRateMock: vi.fn(),
}));

vi.mock('@/lib/actions/analytics-actions', () => ({
  getAnalyticsSummary: getAnalyticsSummaryMock,
  getTicketsByHour: getTicketsByHourMock,
  getTicketsByDepartment: getTicketsByDepartmentMock,
  getWaitTimeTrend: getWaitTimeTrendMock,
  getStaffPerformance: getStaffPerformanceMock,
  getFeedbackSummary: getFeedbackSummaryMock,
  getTemplateHealthAnalytics: getTemplateHealthAnalyticsMock,
  getTemplatePerformanceAnalytics: getTemplatePerformanceAnalyticsMock,
  getHourlyHeatmap: getHourlyHeatmapMock,
  getServiceBreakdown: getServiceBreakdownMock,
  getWeeklyTrends: getWeeklyTrendsMock,
  getNoShowRate: getNoShowRateMock,
}));

import { AnalyticsDashboard } from './analytics-dashboard';

const initialSummary: AnalyticsSummary = {
  totalTicketsToday: 10,
  avgWaitTime: 8,
  avgServiceTime: 12,
  avgSatisfaction: 4.2,
};

const updatedSummary: AnalyticsSummary = {
  totalTicketsToday: 24,
  avgWaitTime: 11,
  avgServiceTime: 14,
  avgSatisfaction: 4.6,
};

const hourlyTickets: HourlyTicket[] = [{ hour: 9, count: 5 }];
const departmentTickets: DepartmentTicket[] = [
  { department_id: 'dep-1', department_name: 'Retail Banking', count: 7 },
];
const waitTrend: WaitTimeTrend[] = [{ date: '2026-03-15', avgWaitMinutes: 8 }];
const staffRows: StaffPerformanceRow[] = [
  {
    staff_id: 'staff-1',
    staff_name: 'Amina Ali',
    tickets_served: 11,
    avg_service_time: 12,
    avg_rating: 4.8,
    no_show_count: 1,
  },
];
const feedbackSummary: FeedbackSummaryData = {
  distribution: [{ rating: 5, count: 3 }],
  averageRating: 4.2,
  totalFeedback: 3,
  recentComments: [],
};
const updatedFeedbackSummary: FeedbackSummaryData = {
  distribution: [{ rating: 5, count: 8 }],
  averageRating: 4.6,
  totalFeedback: 8,
  recentComments: [],
};

const initialTemplateHealth: TemplateHealthAnalyticsData = {
  summary: {
    templateId: 'bank-branch',
    templateTitle: 'Bank Branch',
    appliedVersion: '1.0.0',
    latestVersion: '1.1.0',
    snapshotScope: 'organization',
    officeCount: 2,
    officesCurrentCount: 1,
    officesBehindCount: 1,
    officesWithDrift: 1,
    currentDriftCount: 3,
    currentVersionCoveragePercent: 50,
    branchAlignmentPercent: 50,
    organizationUpgradeCountInRange: 1,
    officeRolloutCountInRange: 1,
    driftSnapshotCountInRange: 2,
    totalOrganizationUpgradeCount: 1,
    totalOfficeRolloutCount: 1,
    lastMigrationAt: '2026-03-12T18:00:00.000Z',
    lastOfficeRolloutAt: '2026-03-13T18:00:00.000Z',
  },
  activity: [{ date: '2026-03-15', organizationUpgrades: 1, officeRollouts: 1 }],
  driftTrend: [{ date: '2026-03-15', driftCount: 3, coveragePercent: 50 }],
  officeStatuses: [
    {
      office_id: 'office-1',
      office_name: 'Downtown Branch',
      applied_version: '1.0.0',
      latest_version: '1.1.0',
      is_current: false,
      drift_count: 3,
      rollout_count: 1,
      last_rolled_out_at: '2026-03-13T18:00:00.000Z',
    },
  ],
};

const updatedTemplateHealth: TemplateHealthAnalyticsData = {
  ...initialTemplateHealth,
  summary: {
    ...initialTemplateHealth.summary,
    officeCount: 1,
    officesCurrentCount: 1,
    officesBehindCount: 0,
    officesWithDrift: 0,
    currentDriftCount: 0,
    currentVersionCoveragePercent: 100,
    branchAlignmentPercent: 100,
    organizationUpgradeCountInRange: 2,
    officeRolloutCountInRange: 3,
  },
};

const initialTemplatePerformance: TemplatePerformanceAnalyticsData = {
  summary: {
    primaryTemplateId: 'bank-branch',
    primaryTemplateTitle: 'Bank Branch',
    primaryVertical: 'bank',
    templateCount: 1,
    officeCount: 2,
    totalTickets: 10,
    waitAccuracyPercent: 72,
    noShowRate: 6,
    completionRate: 88,
    avgServiceTime: 12,
  },
  templateRows: [
    {
      templateId: 'bank-branch',
      templateTitle: 'Bank Branch',
      vertical: 'bank',
      officeCount: 2,
      totalTickets: 10,
      waitAccuracyPercent: 72,
      noShowRate: 6,
      completionRate: 88,
      avgWaitTime: 8,
      avgServiceTime: 12,
    },
  ],
  officeRows: [
    {
      officeId: 'office-1',
      officeName: 'Downtown Branch',
      templateId: 'bank-branch',
      templateTitle: 'Bank Branch',
      vertical: 'bank',
      totalTickets: 10,
      waitAccuracyPercent: 72,
      noShowRate: 6,
      completionRate: 88,
      avgWaitTime: 8,
      avgServiceTime: 12,
    },
  ],
};

const updatedTemplatePerformance: TemplatePerformanceAnalyticsData = {
  ...initialTemplatePerformance,
  summary: {
    ...initialTemplatePerformance.summary,
    officeCount: 1,
    totalTickets: 24,
    waitAccuracyPercent: 91,
    noShowRate: 2,
    completionRate: 96,
    avgServiceTime: 14,
  },
  officeRows: [
    {
      officeId: 'office-2',
      officeName: 'Uptown Branch',
      templateId: 'bank-branch',
      templateTitle: 'Bank Branch',
      vertical: 'bank',
      totalTickets: 24,
      waitAccuracyPercent: 91,
      noShowRate: 2,
      completionRate: 96,
      avgWaitTime: 11,
      avgServiceTime: 14,
    },
  ],
};

const initialHourlyHeatmap: HourlyHeatmapCell[] = [{ hour: 9, dayOfWeek: 1, count: 3 }];
const initialServiceBreakdown: ServiceBreakdownRow[] = [
  {
    service_id: 'svc-1',
    service_name: 'Account Opening',
    ticket_count: 5,
    avg_wait_minutes: 7,
    avg_service_minutes: 10,
    no_show_count: 0,
  },
];
const initialWeeklyTrends: WeeklyTrendDay[] = [
  { date: '2026-03-15', total_tickets: 10, avg_wait_minutes: 8, avg_service_minutes: 12, no_show_count: 1 },
];
const initialNoShowRate: NoShowRateData = { total_tickets: 10, no_shows: 1, rate: 10 };

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAnalyticsSummaryMock.mockResolvedValue(updatedSummary);
    getTicketsByHourMock.mockResolvedValue(hourlyTickets);
    getTicketsByDepartmentMock.mockResolvedValue(departmentTickets);
    getWaitTimeTrendMock.mockResolvedValue(waitTrend);
    getStaffPerformanceMock.mockResolvedValue(staffRows);
    getFeedbackSummaryMock.mockResolvedValue(updatedFeedbackSummary);
    getTemplateHealthAnalyticsMock.mockResolvedValue(updatedTemplateHealth);
    getTemplatePerformanceAnalyticsMock.mockResolvedValue(updatedTemplatePerformance);
    getHourlyHeatmapMock.mockResolvedValue(initialHourlyHeatmap);
    getServiceBreakdownMock.mockResolvedValue(initialServiceBreakdown);
    getWeeklyTrendsMock.mockResolvedValue(initialWeeklyTrends);
    getNoShowRateMock.mockResolvedValue(initialNoShowRate);
  });

  it('applies office and date filters before refreshing analytics', async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider locale="en">
      <AnalyticsDashboard
        initialSummary={initialSummary}
        initialTicketsByHour={hourlyTickets}
        initialTicketsByDepartment={departmentTickets}
        initialWaitTimeTrend={waitTrend}
        initialStaffPerformance={staffRows}
        initialFeedbackSummary={feedbackSummary}
        initialTemplateHealth={initialTemplateHealth}
        initialTemplatePerformance={initialTemplatePerformance}
        initialHourlyHeatmap={initialHourlyHeatmap}
        initialServiceBreakdown={initialServiceBreakdown}
        initialWeeklyTrends={initialWeeklyTrends}
        initialNoShowRate={initialNoShowRate}
        offices={[
          { id: 'office-1', name: 'Downtown Branch' },
          { id: 'office-2', name: 'Uptown Branch' },
        ]}
        departments={[{ id: 'dep-1', name: 'Retail Banking', office_id: 'office-2' }]}
      />
      </LocaleProvider>
    );

    await user.selectOptions(screen.getByLabelText('Date Range'), 'last30');
    await user.selectOptions(screen.getByLabelText('Office Filter'), 'office-2');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    await waitFor(() => {
      expect(getAnalyticsSummaryMock).toHaveBeenCalledWith('office-2', 'last30');
      expect(getTicketsByHourMock).toHaveBeenCalledWith('office-2');
      expect(getTicketsByDepartmentMock).toHaveBeenCalledWith('office-2', 'last30');
      expect(getWaitTimeTrendMock).toHaveBeenCalledWith('office-2', 30);
      expect(getStaffPerformanceMock).toHaveBeenCalledWith('office-2', 'last30');
      expect(getFeedbackSummaryMock).toHaveBeenCalledWith('office-2', 'last30');
      expect(getTemplateHealthAnalyticsMock).toHaveBeenCalledWith('office-2', 'last30');
      expect(getTemplatePerformanceAnalyticsMock).toHaveBeenCalledWith('office-2', 'last30');
    });

    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('91%')).toBeTruthy();
    expect(screen.getAllByText('8 ratings').length).toBeGreaterThan(0);
  });

  it('refreshes analytics using the current filter state from the header button', async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider locale="en">
      <AnalyticsDashboard
        initialSummary={initialSummary}
        initialTicketsByHour={hourlyTickets}
        initialTicketsByDepartment={departmentTickets}
        initialWaitTimeTrend={waitTrend}
        initialStaffPerformance={staffRows}
        initialFeedbackSummary={feedbackSummary}
        initialTemplateHealth={initialTemplateHealth}
        initialTemplatePerformance={initialTemplatePerformance}
        initialHourlyHeatmap={initialHourlyHeatmap}
        initialServiceBreakdown={initialServiceBreakdown}
        initialWeeklyTrends={initialWeeklyTrends}
        initialNoShowRate={initialNoShowRate}
        offices={[
          { id: 'office-1', name: 'Downtown Branch' },
          { id: 'office-2', name: 'Uptown Branch' },
        ]}
        departments={[{ id: 'dep-1', name: 'Retail Banking', office_id: 'office-2' }]}
      />
      </LocaleProvider>
    );

    await user.selectOptions(screen.getByLabelText('Date Range'), 'last7');
    await user.selectOptions(screen.getByLabelText('Office Filter'), 'office-1');
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }));

    await waitFor(() => {
      expect(getAnalyticsSummaryMock).toHaveBeenCalledWith('office-1', 'last7');
      expect(getWaitTimeTrendMock).toHaveBeenCalledWith('office-1', 7);
    });
  });
});
