// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyIndustryTemplateSetupMock } = vi.hoisted(() => ({
  applyIndustryTemplateSetupMock: vi.fn(),
}));

vi.mock('@/lib/actions/platform-actions', () => ({
  applyIndustryTemplateSetup: applyIndustryTemplateSetupMock,
}));

import { TemplateOnboardingClient } from './template-onboarding-client';

describe('TemplateOnboardingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the first office name for new organizations', () => {
    render(
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={0}
        currentTemplate={{
          id: 'standard',
          title: 'Standard Queue',
          vertical: 'standard',
          version: '1.2.0',
          dashboardMode: 'standard',
          operatingModel: 'department_first',
          branchType: 'general_office',
          enabledModules: ['kiosk'],
          recommendedRoles: ['admin'],
        }}
      />
    );

    expect((screen.getByLabelText('Starter Office Name') as HTMLInputElement).value).toBe(
      'QueueFlow Main Location'
    );
  });

  it('updates dependent settings when the template changes', async () => {
    const user = userEvent.setup();

    render(
      <TemplateOnboardingClient
        organization={{ id: 'org-1', name: 'QueueFlow' }}
        existingOfficeCount={2}
        currentTemplate={{
          id: 'standard',
          title: 'Standard Queue',
          vertical: 'standard',
          version: '1.2.0',
          dashboardMode: 'standard',
          operatingModel: 'department_first',
          branchType: 'general_office',
          enabledModules: ['kiosk'],
          recommendedRoles: ['admin'],
        }}
      />
    );

    await user.selectOptions(screen.getByLabelText('Industry Template'), 'restaurant-waitlist');

    expect((screen.getByLabelText('Operating Model') as HTMLSelectElement).value).toBe('waitlist');
    expect((screen.getByLabelText('Branch Type') as HTMLSelectElement).value).toBe(
      'restaurant_floor'
    );
    expect((screen.getByLabelText('Create starter display screen') as HTMLInputElement).checked).toBe(
      false
    );
    expect((screen.getByLabelText('Seed starter priorities') as HTMLInputElement).checked).toBe(
      false
    );
    expect(screen.getByText('Set up a guest waitlist')).toBeTruthy();
    expect(screen.getByText(/Table for 1-2/)).toBeTruthy();
  });

  it('submits the onboarding action and shows a success message', async () => {
    const user = userEvent.setup();
    applyIndustryTemplateSetupMock.mockResolvedValue({
      success: true,
      data: {
        departmentsCreated: 3,
        servicesCreated: 9,
      },
    });

    render(
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
    );

    await user.clear(screen.getByLabelText('Starter Office Name'));
    await user.type(screen.getByLabelText('Starter Office Name'), 'Neighborhood Clinic');
    await user.click(screen.getByLabelText('Apply Template'));

    await waitFor(() => {
      expect(applyIndustryTemplateSetupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'clinic',
          operatingModel: 'appointments_first',
          branchType: 'community_clinic',
          officeName: 'Neighborhood Clinic',
        })
      );
    });

    expect(
      screen.getByText('Template applied. Created 3 departments and 9 services.')
    ).toBeTruthy();
  });

  it('shows the returned error message when onboarding fails', async () => {
    const user = userEvent.setup();
    applyIndustryTemplateSetupMock.mockResolvedValue({
      error: 'Failed to create starter office',
    });

    render(
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
    );

    await user.click(screen.getByLabelText('Apply Template'));

    expect(await screen.findByText('Failed to create starter office')).toBeTruthy();
  });
});
