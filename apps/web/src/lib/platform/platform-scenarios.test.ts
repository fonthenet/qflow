import { describe, expect, it } from 'vitest';
import { getAllowedNavigation, resolvePlatformConfig } from './config';
import {
  buildOfficeRolloutSettings,
  buildTemplateGovernanceReport,
  buildTemplateUpgradeSettings,
} from './governance';
import { getIndustryTemplateById, industryTemplates } from './templates';

const VERTICAL_SCENARIOS = [
  {
    templateId: 'public-service',
    officeName: 'Central Service Center',
    expected: {
      vertical: 'public_service',
      dashboardMode: 'public_service',
      queueLifecycle: 'ticket',
      routingMode: 'department_first',
      numberingFormat: 'department_sequence',
      remoteJoin: 'enabled',
      privacySafeDisplay: false,
      requiredNav: '/admin/template-governance',
    },
  },
  {
    templateId: 'bank-branch',
    officeName: 'Downtown Bank',
    expected: {
      vertical: 'bank',
      dashboardMode: 'bank',
      queueLifecycle: 'hybrid',
      routingMode: 'service_first',
      numberingFormat: 'service_sequence',
      remoteJoin: 'enabled',
      privacySafeDisplay: true,
      requiredNav: '/admin/analytics',
    },
  },
  {
    templateId: 'clinic',
    officeName: 'Community Clinic',
    expected: {
      vertical: 'clinic',
      dashboardMode: 'clinic',
      queueLifecycle: 'hybrid',
      routingMode: 'department_first',
      numberingFormat: 'department_sequence',
      remoteJoin: 'limited',
      privacySafeDisplay: true,
      requiredNav: '/admin/audit',
    },
  },
  {
    templateId: 'restaurant-waitlist',
    officeName: 'Harbor Grill',
    expected: {
      vertical: 'restaurant',
      dashboardMode: 'light_service',
      queueLifecycle: 'waitlist',
      routingMode: 'staff_preference',
      numberingFormat: 'named_waitlist',
      remoteJoin: 'enabled',
      privacySafeDisplay: false,
      requiredNav: '/desk',
    },
  },
  {
    templateId: 'barbershop',
    officeName: 'Northside Barber',
    expected: {
      vertical: 'barbershop',
      dashboardMode: 'light_service',
      queueLifecycle: 'waitlist',
      routingMode: 'staff_preference',
      numberingFormat: 'named_waitlist',
      remoteJoin: 'enabled',
      privacySafeDisplay: false,
      requiredNav: '/desk',
    },
  },
] as const;

function createOrganizationSettings(templateId: string) {
  const template = getIndustryTemplateById(templateId);
  const starterOffice = template.starterOffices[0];

  if (!starterOffice) {
    throw new Error(`Template ${templateId} is missing a starter office`);
  }

  return {
    platform_template_id: template.id,
    platform_template_version: '1.0.0',
    platform_vertical: template.vertical,
    platform_operating_model:
      template.vertical === 'bank'
        ? 'service_routing'
        : template.vertical === 'clinic'
          ? 'appointments_first'
          : template.vertical === 'public_service'
            ? 'department_first'
            : 'waitlist',
    platform_branch_type: starterOffice.branchType,
    platform_workflow_profile: {
      ...template.workflowProfile,
      noShowPolicy: {
        ...template.workflowProfile.noShowPolicy,
        timeoutMinutes: Math.max(1, template.workflowProfile.noShowPolicy.timeoutMinutes - 2),
      },
    },
    platform_queue_policy: {
      ...template.queuePolicy,
      capacityLimit: Math.max(1, template.queuePolicy.capacityLimit - 10),
    },
    platform_experience_profile: {
      ...template.experienceProfile,
      kiosk: {
        ...template.experienceProfile.kiosk,
        idleTimeoutSeconds: Math.max(15, template.experienceProfile.kiosk.idleTimeoutSeconds - 10),
      },
    },
    platform_role_policy: template.rolePolicy,
    platform_capability_overrides: template.capabilityFlags,
  };
}

describe('multi-industry platform scenarios', () => {
  it('ships starter coverage for the five launch verticals', () => {
    expect(industryTemplates).toHaveLength(5);
    expect(industryTemplates.map((template) => template.vertical)).toEqual(
      expect.arrayContaining(['public_service', 'bank', 'clinic', 'restaurant', 'barbershop'])
    );
  });

  it.each(VERTICAL_SCENARIOS)(
    'resolves the $templateId template as a runnable scenario',
    ({ templateId, expected }) => {
      const template = getIndustryTemplateById(templateId);
      const starterOffice = template.starterOffices[0];

      const config = resolvePlatformConfig({
        organizationSettings: {
          platform_template_id: template.id,
          platform_template_version: template.version.current,
          platform_vertical: template.vertical,
          platform_operating_model:
            template.vertical === 'bank'
              ? 'service_routing'
              : template.vertical === 'clinic'
                ? 'appointments_first'
                : template.vertical === 'public_service'
                  ? 'department_first'
                  : 'waitlist',
          platform_branch_type: starterOffice?.branchType,
        },
      });

      expect(config.selection.vertical).toBe(expected.vertical);
      expect(config.experienceProfile.dashboardMode).toBe(expected.dashboardMode);
      expect(config.workflowProfile.queueLifecycle).toBe(expected.queueLifecycle);
      expect(config.queuePolicy.routingMode).toBe(expected.routingMode);
      expect(config.queuePolicy.numberingFormat).toBe(expected.numberingFormat);
      expect(config.queuePolicy.remoteJoin).toBe(expected.remoteJoin);
      expect(config.capabilityFlags.privacySafeDisplay).toBe(expected.privacySafeDisplay);
      expect(config.template.starterOffices.length).toBeGreaterThan(0);
      const starterOfficeData = config.template.starterOffices[0];
      expect(starterOfficeData).toBeDefined();
      expect(starterOfficeData!.desks.length).toBeGreaterThan(0);
      expect(starterOfficeData!.officeSettings).toBeTruthy();
      expect(config.template.recommendedRoles.length).toBeGreaterThan(0);
      expect(getAllowedNavigation(config.rolePolicy, 'admin')).toContain(expected.requiredNav);
    }
  );

  it.each(VERTICAL_SCENARIOS)(
    'detects organization and office drift for the $templateId scenario',
    ({ templateId, officeName }) => {
      const organizationSettings = createOrganizationSettings(templateId);
      const report = buildTemplateGovernanceReport({
        organizationSettings,
        offices: [
          {
            id: `${templateId}-office`,
            name: officeName,
            settings: {
              platform_template_id: templateId,
              platform_template_version: '1.0.0',
              platform_queue_policy: {
                capacityLimit: 9,
              },
            },
          },
        ],
      });

      expect(report.templateId).toBe(templateId);
      expect(report.isUpgradeAvailable).toBe(true);
      expect(report.migrationReports.length).toBeGreaterThan(0);
      expect(report.organizationDriftCount).toBeGreaterThan(0);
      expect(report.officesBehindCount).toBe(1);
      expect(report.officesWithDrift).toBe(1);
      expect(report.officeReports[0]?.driftCount).toBeGreaterThan(0);
    }
  );

  it('applies keep-current vs adopt-default strategies during an org upgrade', () => {
    const organizationSettings = createOrganizationSettings('bank-branch');
    const upgradedSettings = buildTemplateUpgradeSettings({
      organizationSettings,
      sectionStrategies: {
        workflow_profile: 'keep_current',
        queue_policy: 'adopt_defaults',
      },
    });
    const template = getIndustryTemplateById('bank-branch');

    expect(upgradedSettings.platform_template_version).toBe(template.version.current);
    expect(upgradedSettings.platform_workflow_profile).toEqual(
      resolvePlatformConfig({ organizationSettings }).workflowProfile
    );
    expect(upgradedSettings.platform_queue_policy).toEqual(template.queuePolicy);
  });

  it('records office rollout history and clears section overrides when defaults are adopted', () => {
    const organizationSettings = createOrganizationSettings('clinic');
    const officeSettings = {
      platform_template_id: 'clinic',
      platform_template_version: '1.0.0',
      platform_queue_policy: {
        capacityLimit: 7,
      },
      platform_role_policy: {
        roles: [],
      },
      platform_rollout_history: [
        {
          rolled_out_at: '2026-03-01T00:00:00.000Z',
          from_version: '1.0.0',
          to_version: '1.0.0',
          section_strategies: {
            queue_policy: 'keep_current',
          },
        },
      ],
    };

    const rolledOutSettings = buildOfficeRolloutSettings({
      organizationSettings,
      officeSettings,
      sectionStrategies: {
        queue_policy: 'adopt_defaults',
        role_policy: 'keep_current',
      },
    });

    expect(rolledOutSettings.platform_template_version).toBe(
      getIndustryTemplateById('clinic').version.current
    );
    expect(rolledOutSettings.platform_queue_policy).toBeUndefined();
    expect(rolledOutSettings.platform_role_policy).toEqual(
      resolvePlatformConfig({
        organizationSettings,
        officeSettings,
      }).rolePolicy
    );
    expect(Array.isArray(rolledOutSettings.platform_rollout_history)).toBe(true);
    expect(rolledOutSettings.platform_rollout_history).toHaveLength(2);
    expect(
      (rolledOutSettings.platform_rollout_history as Array<Record<string, unknown>>)[1]
        ?.section_strategies
    ).toEqual({
      queue_policy: 'adopt_defaults',
      role_policy: 'keep_current',
    });
  });
});
