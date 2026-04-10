// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateGovernanceReport } from '@/lib/platform/governance';
import { LocaleProvider } from '@/components/providers/locale-provider';

const { upgradeIndustryTemplateSettingsMock, rolloutIndustryTemplateToOfficesMock, refreshMock } =
  vi.hoisted(() => ({
    upgradeIndustryTemplateSettingsMock: vi.fn(),
    rolloutIndustryTemplateToOfficesMock: vi.fn(),
    refreshMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock('@/lib/actions/platform-actions', () => ({
  upgradeIndustryTemplateSettings: upgradeIndustryTemplateSettingsMock,
  rolloutIndustryTemplateToOffices: rolloutIndustryTemplateToOfficesMock,
}));

import { TemplateGovernanceClient } from './template-governance-client';

const governanceReport: TemplateGovernanceReport = {
  templateId: 'bank-branch',
  templateTitle: 'Bank Branch',
  appliedVersion: '1.0.0',
  latestVersion: '1.1.0',
  isUpgradeAvailable: true,
  safeChangeCount: 4,
  reviewRequiredChangeCount: 2,
  breakingChangeCount: 0,
  migrationReports: [
    {
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      releasedAt: '2026-03-10',
      summary: 'Adds stronger branch comparison defaults.',
      officeRolloutRecommended: true,
      safeChanges: 4,
      reviewRequiredChanges: 2,
      breakingChanges: 0,
      changes: [
        {
          id: 'chg-1',
          section: 'capability_flags',
          title: 'Enable branch comparison',
          description: 'Adds branch comparison to bank analytics.',
          impact: 'safe',
          recommendedAction: 'Review analytics dashboards after rollout.',
        },
      ],
    },
  ],
  organizationDriftCount: 3,
  organizationSections: [
    {
      key: 'capability_flags',
      label: 'Capabilities',
      settingsKey: 'platform_capability_overrides',
      driftCount: 2,
      driftPaths: ['branchComparison', 'staffAssignment'],
    },
    {
      key: 'queue_policy',
      label: 'Queue Policy',
      settingsKey: 'platform_queue_policy',
      driftCount: 0,
      driftPaths: [],
    },
  ],
  officeDriftCount: 2,
  officesWithDrift: 1,
  officesBehindCount: 1,
  migrationHistory: [
    {
      appliedAt: '2026-03-12T18:00:00.000Z',
      fromVersion: '1.0.0',
      toVersion: '1.0.5',
      sectionStrategies: {
        capability_flags: 'keep_current',
      },
      migrationCount: 1,
      safeChangeCount: 1,
      reviewRequiredChangeCount: 0,
      breakingChangeCount: 0,
    },
  ],
  officeRolloutHistory: [
    {
      officeId: 'office-1',
      officeName: 'Downtown Branch',
      rolledOutAt: '2026-03-13T18:00:00.000Z',
      fromVersion: '1.0.0',
      toVersion: '1.0.5',
      sectionStrategies: {
        capability_flags: 'keep_current',
      },
    },
  ],
  healthSummary: {
    officeCount: 2,
    officesCurrentCount: 1,
    officesBehindCount: 1,
    officesWithDrift: 1,
    currentVersionCoveragePercent: 50,
    branchAlignmentPercent: 50,
    organizationMigrationCount: 1,
    officeRolloutCount: 1,
    lastMigrationAt: '2026-03-12T18:00:00.000Z',
    lastOfficeRolloutAt: '2026-03-13T18:00:00.000Z',
  },
  officeReports: [
    {
      officeId: 'office-1',
      officeName: 'Downtown Branch',
      appliedVersion: '1.0.0',
      latestVersion: '1.1.0',
      isUpgradeAvailable: true,
      driftCount: 2,
      sections: [
        {
          key: 'capability_flags',
          label: 'Capabilities',
          settingsKey: 'platform_capability_overrides',
          driftCount: 2,
          driftPaths: ['branchComparison', 'staffAssignment'],
        },
      ],
      rolloutCount: 1,
      lastRolledOutAt: '2026-03-13T18:00:00.000Z',
      rolloutHistory: [],
    },
    {
      officeId: 'office-2',
      officeName: 'Uptown Branch',
      appliedVersion: '1.1.0',
      latestVersion: '1.1.0',
      isUpgradeAvailable: false,
      driftCount: 0,
      sections: [],
      rolloutCount: 0,
      lastRolledOutAt: null,
      rolloutHistory: [],
    },
  ],
};

describe('TemplateGovernanceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies an organization upgrade with the selected section strategies', async () => {
    const user = userEvent.setup();
    upgradeIndustryTemplateSettingsMock.mockResolvedValue({
      success: true,
      data: {
        organizationDriftCount: 0,
      },
    });

    render(
      <LocaleProvider locale="en">
      <TemplateGovernanceClient
        organization={{ id: 'org-1', name: 'QueueFlow Financial' }}
        templateSummary={{
          id: 'bank-branch',
          title: 'Bank Branch',
          vertical: 'bank',
          version: '1.0.0',
          dashboardMode: 'bank',
          operatingModel: 'service_routing',
          branchType: 'branch_office',
          enabledModules: ['appointments', 'branch-comparison'],
          recommendedRoles: ['admin', 'branch_admin'],
        }}
        governanceReport={governanceReport}
      />
      </LocaleProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Capabilities Adopt Defaults' }));
    await user.click(screen.getByRole('button', { name: /Save choices/i }));

    await waitFor(() => {
      expect(upgradeIndustryTemplateSettingsMock).toHaveBeenCalledWith({
        sectionStrategies: {
          capability_flags: 'adopt_defaults',
          queue_policy: 'adopt_defaults',
        },
      });
    });

    expect(
      screen.getByText('Template governance applied. Organization drift is now 0.')
    ).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('rolls template changes out to the currently selected offices', async () => {
    const user = userEvent.setup();
    rolloutIndustryTemplateToOfficesMock.mockResolvedValue({
      success: true,
      data: {
        updatedOffices: 1,
      },
    });

    render(
      <LocaleProvider locale="en">
      <TemplateGovernanceClient
        organization={{ id: 'org-1', name: 'QueueFlow Financial' }}
        templateSummary={{
          id: 'bank-branch',
          title: 'Bank Branch',
          vertical: 'bank',
          version: '1.0.0',
          dashboardMode: 'bank',
          operatingModel: 'service_routing',
          branchType: 'branch_office',
          enabledModules: ['appointments', 'branch-comparison'],
          recommendedRoles: ['admin', 'branch_admin'],
        }}
        governanceReport={governanceReport}
      />
      </LocaleProvider>
    );

    await user.click(screen.getByLabelText('Select office Downtown Branch'));
    await user.click(screen.getByRole('button', { name: /Select All Candidates/i }));
    await user.click(screen.getByRole('button', { name: /Roll Out To Selected Offices/i }));

    await waitFor(() => {
      expect(rolloutIndustryTemplateToOfficesMock).toHaveBeenCalledWith({
        officeIds: ['office-1'],
        sectionStrategies: {
          capability_flags: 'keep_current',
          queue_policy: 'adopt_defaults',
        },
      });
    });

    expect(screen.getByText('Rolled template changes to 1 office(s).')).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();
  });
});
