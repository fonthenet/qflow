// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';

const { saveIndustryTemplateTrialMock, confirmIndustryTemplateSetupMock, clearIndustryTemplateTrialMock } =
  vi.hoisted(() => ({
    saveIndustryTemplateTrialMock: vi.fn(),
    confirmIndustryTemplateSetupMock: vi.fn(),
    clearIndustryTemplateTrialMock: vi.fn(),
  }));

vi.mock('@/lib/actions/platform-actions', () => ({
  saveIndustryTemplateTrial: saveIndustryTemplateTrialMock,
  confirmIndustryTemplateSetup: confirmIndustryTemplateSetupMock,
  clearIndustryTemplateTrial: clearIndustryTemplateTrialMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { TemplateOnboardingClient } from './template-onboarding-client';

const publicServiceTemplate = {
  id: 'public-service',
  title: 'Public Service Branch',
  vertical: 'public_service',
  version: '1.1.0',
  dashboardMode: 'public_service',
  operatingModel: 'department_first',
  branchType: 'service_center',
  enabledModules: ['kiosk'],
  recommendedRoles: ['admin'],
};

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
          currentTemplate={publicServiceTemplate}
        />
      </LocaleProvider>
    );

    expect(screen.getByDisplayValue('QueueFlow Main Location')).toBeTruthy();
  });

  it('updates operating model when the template changes', async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider locale="en">
        <TemplateOnboardingClient
          organization={{ id: 'org-1', name: 'QueueFlow' }}
          existingOfficeCount={0}
          currentTemplate={publicServiceTemplate}
        />
      </LocaleProvider>
    );

    expect(screen.getByDisplayValue('Customers choose an area first')).toBeTruthy();

    await user.click(screen.getByText('Restaurant Waitlist'));

    expect(screen.getByDisplayValue('Simple waitlist')).toBeTruthy();
  });

  it('saves a draft and shows a success message', async () => {
    const user = userEvent.setup();
    saveIndustryTemplateTrialMock.mockResolvedValue({ success: true });

    render(
      <LocaleProvider locale="en">
        <TemplateOnboardingClient
          organization={{ id: 'org-1', name: 'QueueFlow' }}
          existingOfficeCount={0}
          currentTemplate={publicServiceTemplate}
        />
      </LocaleProvider>
    );

    await user.click(screen.getByText('Save draft'));

    await waitFor(() => {
      expect(saveIndustryTemplateTrialMock).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'public-service',
          operatingModel: 'department_first',
          branchType: 'service_center',
          officeName: 'QueueFlow Main Location',
        })
      );
    });

    expect(screen.getByText('Draft saved. Nothing live was created yet.')).toBeTruthy();
  });

  it('shows the returned error message when saving fails', async () => {
    const user = userEvent.setup();
    saveIndustryTemplateTrialMock.mockResolvedValue({
      error: 'Failed to create starter office',
    });

    render(
      <LocaleProvider locale="en">
        <TemplateOnboardingClient
          organization={{ id: 'org-1', name: 'QueueFlow' }}
          existingOfficeCount={0}
          currentTemplate={publicServiceTemplate}
        />
      </LocaleProvider>
    );

    await user.click(screen.getByText('Save draft'));

    expect(await screen.findByText('Failed to create starter office')).toBeTruthy();
  });
});
