// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';

const { confirmIndustryTemplateSetupMock, saveIndustryTemplateTrialMock, clearIndustryTemplateTrialMock, refreshMock, pushMock } = vi.hoisted(() => ({
  confirmIndustryTemplateSetupMock: vi.fn(),
  saveIndustryTemplateTrialMock: vi.fn(),
  clearIndustryTemplateTrialMock: vi.fn(),
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
  }),
}));

vi.mock('@/lib/actions/platform-actions', () => ({
  confirmIndustryTemplateSetup: confirmIndustryTemplateSetupMock,
  saveIndustryTemplateTrial: saveIndustryTemplateTrialMock,
  clearIndustryTemplateTrial: clearIndustryTemplateTrialMock,
}));

import { TemplateOnboardingClient } from './template-onboarding-client';

describe('TemplateOnboardingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the first office name for new organizations', () => {
    render(
      <LocaleProvider locale="en">
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={0}
        currentTemplate={{
          id: 'public-service',
          title: 'Public Service Branch',
          vertical: 'public_service',
          version: '1.1.0',
          dashboardMode: 'public_service',
          operatingModel: 'department_first',
          branchType: 'service_center',
          enabledModules: ['kiosk'],
          recommendedRoles: ['admin'],
        }}
      />
      </LocaleProvider>
    );

    expect((screen.getByDisplayValue('QueueFlow Main Location') as HTMLInputElement).value).toBe(
      'QueueFlow Main Location'
    );
  });

  it('updates dependent settings when the template changes', async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider locale="en">
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={2}
        currentTemplate={{
          id: 'public-service',
          title: 'Public Service Branch',
          vertical: 'public_service',
          version: '1.1.0',
          dashboardMode: 'public_service',
          operatingModel: 'department_first',
          branchType: 'service_center',
          enabledModules: ['kiosk'],
          recommendedRoles: ['admin'],
        }}
      />
      </LocaleProvider>
    );

    await user.click(screen.getByRole('button', { name: /Restaurant Waitlist/i }));

    // Operating model select should show 'Simple waitlist' (value='waitlist')
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const operatingModelSelect = selects.find((s) => s.value === 'waitlist');
    expect(operatingModelSelect).toBeTruthy();
    // Branch type select should show restaurant_floor
    const branchTypeSelect = selects.find((s) => s.value === 'restaurant_floor');
    expect(branchTypeSelect).toBeTruthy();
    // Display screens checkbox should be unchecked (restaurant displayBoard = false)
    expect((screen.getByRole('checkbox', { name: 'Create starter display screens' }) as HTMLInputElement).checked).toBe(
      false
    );
    // Seed priorities checkbox should not be rendered (restaurant has no starterPriorities)
    expect(screen.queryByRole('checkbox', { name: 'Include priority options' })).toBeNull();
  });

  it('submits the onboarding action and shows a success message', async () => {
    const user = userEvent.setup();
    confirmIndustryTemplateSetupMock.mockResolvedValue({
      success: true,
      data: {
        departmentsCreated: 3,
        servicesCreated: 9,
        desksCreated: 2,
      },
    });

    render(
      <LocaleProvider locale="en">
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={1}
        currentTemplate={{
          id: 'clinic',
          title: 'Clinic',
          vertical: 'clinic',
          version: '1.1.0',
          dashboardMode: 'clinic',
          operatingModel: 'appointments_first',
          branchType: 'community_clinic',
          enabledModules: ['appointments'],
          recommendedRoles: ['admin'],
        }}
      />
      </LocaleProvider>
    );

    const officeNameInput = screen.getByDisplayValue('QueueFlow Main Location');
    await user.clear(officeNameInput);
    await user.type(officeNameInput, 'Neighborhood Clinic');
    await user.click(screen.getByRole('button', { name: 'Use this setup' }));

    await waitFor(() => {
      expect(confirmIndustryTemplateSetupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'clinic',
          operatingModel: 'appointments_first',
          branchType: 'community_clinic',
          officeName: 'Neighborhood Clinic',
        })
      );
    });

    expect(
      screen.getByText('Setup confirmed. Created 3 areas, 9 services, and 2 counters.')
    ).toBeTruthy();
  });

  it('shows the returned error message when onboarding fails', async () => {
    const user = userEvent.setup();
    confirmIndustryTemplateSetupMock.mockResolvedValue({
      error: 'Failed to create starter office',
    });

    render(
      <LocaleProvider locale="en">
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={1}
        currentTemplate={{
          id: 'bank-branch',
          title: 'Bank Branch',
          vertical: 'bank',
          version: '1.1.0',
          dashboardMode: 'bank',
          operatingModel: 'service_routing',
          branchType: 'branch_office',
          enabledModules: ['appointments'],
          recommendedRoles: ['admin'],
        }}
      />
      </LocaleProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Use this setup' }));

    expect(await screen.findByText('Failed to create starter office')).toBeTruthy();
  });
});
