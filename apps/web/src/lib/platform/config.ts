import {
  deepMergeRecords,
  type BranchType,
  type CapabilityFlags,
  type ExperienceProfile,
  type OperatingModel,
  type PlatformTemplateSelection,
  type QueuePolicy,
  type ResolvedPlatformConfig,
  type RoleDefinition,
  type RolePolicy,
  type TemplateLifecycleState,
  type WorkflowProfile,
} from '@queueflow/shared';
import { getIndustryTemplateById } from './templates';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function buildPlatformSelection(params: {
  templateId: string;
  operatingModel: OperatingModel;
  branchType: BranchType;
  appliedAt?: string;
}): PlatformTemplateSelection {
  const template = getIndustryTemplateById(params.templateId);

  return {
    templateId: template.id,
    vertical: template.vertical,
    version: template.version.current,
    operatingModel: params.operatingModel,
    branchType: params.branchType,
    appliedAt: params.appliedAt ?? new Date().toISOString(),
  };
}

function readTemplateSelection(
  record: UnknownRecord,
  prefix: 'platform_' | 'platform_trial_'
): PlatformTemplateSelection {
  const templateId =
    typeof record[`${prefix}template_id`] === 'string'
      ? (record[`${prefix}template_id`] as string)
      : undefined;
  const template = getIndustryTemplateById(templateId);
  const operatingModel =
    (record[`${prefix}operating_model`] as OperatingModel | undefined) ??
    (template.vertical === 'bank'
      ? 'service_routing'
      : template.vertical === 'clinic'
        ? 'appointments_first'
        : template.vertical === 'standard' || template.vertical === 'public_service'
          ? 'department_first'
          : 'waitlist');
  const branchType =
    (record[`${prefix}branch_type`] as BranchType | undefined) ??
    (template.starterOffices[0]?.branchType ?? 'service_center');

  return {
    templateId: template.id,
    vertical: template.vertical,
    version:
      typeof record[`${prefix}template_version`] === 'string'
        ? (record[`${prefix}template_version`] as string)
        : template.version.current,
    operatingModel,
    branchType,
    appliedAt:
      typeof record[`${prefix}applied_at`] === 'string'
        ? (record[`${prefix}applied_at`] as string)
        : typeof record[`${prefix}updated_at`] === 'string'
          ? (record[`${prefix}updated_at`] as string)
          : new Date().toISOString(),
  };
}

export function getPlatformLifecycleState(
  settings: unknown,
  options?: { hasExistingData?: boolean }
): TemplateLifecycleState {
  const record = asRecord(settings);

  if (
    typeof record.platform_template_confirmed_at === 'string' ||
    record.platform_template_state === 'template_confirmed' ||
    options?.hasExistingData
  ) {
    return 'template_confirmed';
  }

  return 'template_trial_state';
}

export function getPlatformSelection(settings: unknown): PlatformTemplateSelection {
  const record = asRecord(settings);

  return readTemplateSelection(record, 'platform_');
}

export function getTrialPlatformSelection(settings: unknown): PlatformTemplateSelection {
  const record = asRecord(settings);

  return readTemplateSelection(record, 'platform_trial_');
}

function mergeProfile<T extends Record<string, unknown>>(
  base: T,
  organizationSettings: UnknownRecord,
  officeSettings?: UnknownRecord,
  orgKey?: string,
  officeKey?: string
): T {
  return deepMergeRecords(
    base,
    orgKey ? asRecord(organizationSettings[orgKey]) : {},
    officeKey ? asRecord(officeSettings?.[officeKey]) : {}
  );
}

export function resolvePlatformConfig(params: {
  organizationSettings: unknown;
  officeSettings?: unknown;
  mode?: 'live' | 'trial';
}): ResolvedPlatformConfig {
  const organizationSettings = asRecord(params.organizationSettings);
  const officeSettings = asRecord(params.officeSettings);
  const selection =
    params.mode === 'trial'
      ? getTrialPlatformSelection(organizationSettings)
      : getPlatformSelection(organizationSettings);
  const template = getIndustryTemplateById(selection.templateId);

  const capabilityFlags = mergeProfile(
    template.capabilityFlags as unknown as Record<string, unknown>,
    organizationSettings,
    officeSettings,
    'platform_capability_overrides',
    'platform_capability_overrides'
  ) as unknown as CapabilityFlags;

  const workflowProfile = mergeProfile(
    template.workflowProfile as unknown as Record<string, unknown>,
    organizationSettings,
    officeSettings,
    'platform_workflow_profile',
    'platform_workflow_profile'
  ) as unknown as WorkflowProfile;

  const queuePolicy = mergeProfile(
    template.queuePolicy as unknown as Record<string, unknown>,
    organizationSettings,
    officeSettings,
    'platform_queue_policy',
    'platform_queue_policy'
  ) as unknown as QueuePolicy;

  const experienceProfile = mergeProfile(
    template.experienceProfile as unknown as Record<string, unknown>,
    organizationSettings,
    officeSettings,
    'platform_experience_profile',
    'platform_experience_profile'
  ) as unknown as ExperienceProfile;

  const rolePolicy = mergeProfile(
    template.rolePolicy as unknown as Record<string, unknown>,
    organizationSettings,
    officeSettings,
    'platform_role_policy',
    'platform_role_policy'
  ) as unknown as RolePolicy;

  return {
    template,
    selection,
    capabilityFlags,
    workflowProfile,
    queuePolicy,
    experienceProfile,
    rolePolicy,
    organizationSettings,
    officeSettings,
  };
}

export function getRoleDefinition(rolePolicy: RolePolicy, role: string): RoleDefinition | undefined {
  return rolePolicy.roles.find((entry) => entry.role === role);
}

export function getAllowedNavigation(rolePolicy: RolePolicy, role: string): string[] {
  return getRoleDefinition(rolePolicy, role)?.allowedNavigation ?? ['/desk'];
}

export function hasRoleCapability(
  rolePolicy: RolePolicy,
  role: string,
  capability: string
): boolean {
  return getRoleDefinition(rolePolicy, role)?.capabilities.includes(capability) ?? false;
}

export function summarizeTemplate(config: ResolvedPlatformConfig) {
  return {
    id: config.template.id,
    title: config.template.title,
    vertical: config.selection.vertical,
    version: config.selection.version,
    dashboardMode: config.experienceProfile.dashboardMode,
    operatingModel: config.selection.operatingModel,
    branchType: config.selection.branchType,
    enabledModules: config.template.enabledModules,
    recommendedRoles: config.template.recommendedRoles,
    defaultNavigation: config.template.defaultNavigation,
    vocabulary: config.experienceProfile.vocabulary,
  };
}
