/**
 * Pure function that builds the platform_* settings patch for an organization
 * when a template is confirmed during onboarding.
 *
 * This is extracted from `seedConfirmedTemplate` in platform-actions.ts so it
 * can be called from the API route (`/api/onboarding/create-business`) without
 * requiring a server action context, revalidatePath, or redirect.
 *
 * Both the wizard flow (portal) and the Station onboarding route use this
 * function to ensure the same keys are written.
 */

import { type BranchType, type OperatingModel } from '@qflo/shared';
import { buildPlatformSelection } from './config';
import { getIndustryTemplateById } from './templates';
import { applyProfile } from './template-profiles';

/** Keys cleared when moving from trial → confirmed state */
const TRIAL_KEYS = [
  'platform_trial_template_id',
  'platform_trial_template_version',
  'platform_trial_vertical',
  'platform_trial_operating_model',
  'platform_trial_branch_type',
  'platform_trial_applied_at',
  'platform_trial_updated_at',
  'platform_trial_office_name',
  'platform_trial_timezone',
  'platform_trial_create_starter_display',
  'platform_trial_seed_priorities',
  'platform_trial_profile_id',
  'platform_trial_structure',
  'platform_trial_structure_template_id',
  'platform_trial_structure_branch_type',
  'platform_trial_share_token',
] as const;

export interface PlatformTemplateSettingsInput {
  /** industryTemplate id (e.g. "clinic", "bank-branch") */
  industryTemplateId: string;
  profileId?: string | null;
  operatingModel?: OperatingModel;
  branchType?: BranchType;
}

/**
 * Returns the platform_* settings patch that must be merged into
 * `organizations.settings` when confirming a template.
 *
 * Callers are responsible for merging this with the existing settings
 * object before writing to the database.
 */
export function buildPlatformTemplateSettings(
  input: PlatformTemplateSettingsInput,
  currentSettings: Record<string, unknown> = {},
): Record<string, unknown> {
  let template = getIndustryTemplateById(input.industryTemplateId);

  if (input.profileId) {
    template = applyProfile(template, input.profileId);
  }

  // Resolve sensible defaults for operating model and branch type
  const operatingModel: OperatingModel =
    input.operatingModel ??
    (template.vertical === 'bank'
      ? 'service_routing'
      : template.vertical === 'clinic'
        ? 'appointments_first'
        : template.vertical === 'public_service'
          ? 'department_first'
          : 'waitlist');

  const branchType: BranchType =
    input.branchType ?? template.starterOffices[0]?.branchType ?? 'service_center';

  const selection = buildPlatformSelection({
    templateId: template.id,
    operatingModel,
    branchType,
  });

  // Build the confirmed settings patch (mirrors seedConfirmedTemplate logic)
  const patch: Record<string, unknown> = {
    platform_template_state: 'template_confirmed',
    platform_template_confirmed_at: selection.appliedAt,
    platform_template_id: template.id,
    platform_template_version: template.version.current,
    platform_template_applied_at: selection.appliedAt,
    platform_vertical: template.vertical,
    platform_operating_model: selection.operatingModel,
    platform_branch_type: selection.branchType,
    platform_enabled_modules: template.enabledModules,
    platform_default_navigation: template.defaultNavigation,
    platform_workflow_profile: template.workflowProfile,
    platform_queue_policy: template.queuePolicy,
    platform_experience_profile: template.experienceProfile,
    platform_role_policy: template.rolePolicy,
    platform_capability_snapshot: template.capabilityFlags,
  };

  // Remove trial keys from the merged result
  const merged: Record<string, unknown> = { ...currentSettings, ...patch };
  for (const key of TRIAL_KEYS) {
    delete merged[key];
  }

  return merged;
}
