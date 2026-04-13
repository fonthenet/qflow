/**
 * Template derivation — org-level customization helpers.
 *
 * These utilities let an organization customize their resolved template
 * after onboarding. The overrides are stored in org settings and applied
 * on top of the base template + profile.
 *
 * Merge order: tier preset → vertical overlay → profile → org overrides
 */

import type {
  IndustryTemplate,
  CapabilityFlags,
  QueuePolicy,
  WorkflowProfile,
  ExperienceProfile,
} from '@qflo/shared';
import { deepMergeRecords } from '@qflo/shared';
import { getIndustryTemplateById } from './templates';
import { applyProfile } from './template-profiles';

// ── Types ────────────────────────────────────────────────────────────────────

/** What an org can override after onboarding */
export interface TemplateOverrides {
  capabilityFlags?: Partial<CapabilityFlags>;
  queuePolicy?: Partial<QueuePolicy>;
  workflowProfile?: Partial<WorkflowProfile>;
  experienceProfile?: {
    vocabulary?: Partial<ExperienceProfile['vocabulary']>;
    kiosk?: Partial<ExperienceProfile['kiosk']>;
    publicJoin?: Partial<ExperienceProfile['publicJoin']>;
    display?: Partial<ExperienceProfile['display']>;
    messagingTone?: ExperienceProfile['messagingTone'];
    branding?: Partial<ExperienceProfile['branding']>;
    accessibility?: Partial<ExperienceProfile['accessibility']>;
  };
}

/** Settings key shape stored in org settings JSON */
export interface OrgTemplateCustomization {
  platform_template_id: string;
  platform_template_version: string;
  platform_profile_id?: string;
  platform_overrides?: TemplateOverrides;
  platform_customized_at?: string;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * Resolve a fully customized template for an organization.
 *
 * Steps:
 *   1. Load the base template by ID
 *   2. Apply the sub-vertical profile (if any)
 *   3. Apply org-level overrides (if any)
 */
export function resolveCustomizedTemplate(
  templateId: string,
  profileId?: string,
  overrides?: TemplateOverrides,
): IndustryTemplate {
  // Step 1: base template
  let template = getIndustryTemplateById(templateId);

  // Step 2: profile
  if (profileId) {
    template = applyProfile(template, profileId);
  }

  // Step 3: org overrides
  if (overrides && Object.keys(overrides).length > 0) {
    template = applyOverrides(template, overrides);
  }

  return template;
}

/**
 * Apply org-level overrides to a template.
 * Only merges the sections that are present in the overrides object.
 */
export function applyOverrides(
  template: IndustryTemplate,
  overrides: TemplateOverrides,
): IndustryTemplate {
  const result = { ...template };

  if (overrides.capabilityFlags) {
    result.capabilityFlags = { ...result.capabilityFlags, ...overrides.capabilityFlags };
  }

  if (overrides.queuePolicy) {
    result.queuePolicy = { ...result.queuePolicy, ...overrides.queuePolicy };
  }

  if (overrides.workflowProfile) {
    result.workflowProfile = deepMergeRecords(
      result.workflowProfile as unknown as Record<string, unknown>,
      overrides.workflowProfile as unknown as Record<string, unknown>,
    ) as unknown as WorkflowProfile;
  }

  if (overrides.experienceProfile) {
    result.experienceProfile = deepMergeRecords(
      result.experienceProfile as unknown as Record<string, unknown>,
      overrides.experienceProfile as unknown as Record<string, unknown>,
    ) as unknown as ExperienceProfile;
  }

  return result;
}

/**
 * Extract the current org customization from settings.
 * Returns undefined if the org hasn't customized their template.
 */
export function getOrgCustomization(
  settings: Record<string, unknown>,
): OrgTemplateCustomization | undefined {
  const templateId = settings.platform_template_id;
  if (typeof templateId !== 'string') return undefined;

  return {
    platform_template_id: templateId,
    platform_template_version:
      typeof settings.platform_template_version === 'string'
        ? settings.platform_template_version
        : '',
    platform_profile_id:
      typeof settings.platform_profile_id === 'string'
        ? settings.platform_profile_id
        : undefined,
    platform_overrides:
      settings.platform_overrides && typeof settings.platform_overrides === 'object'
        ? (settings.platform_overrides as TemplateOverrides)
        : undefined,
    platform_customized_at:
      typeof settings.platform_customized_at === 'string'
        ? settings.platform_customized_at
        : undefined,
  };
}

/**
 * Build the settings patch to persist org customization.
 */
export function buildCustomizationPatch(
  customization: OrgTemplateCustomization,
): Record<string, unknown> {
  return {
    platform_template_id: customization.platform_template_id,
    platform_template_version: customization.platform_template_version,
    ...(customization.platform_profile_id
      ? { platform_profile_id: customization.platform_profile_id }
      : {}),
    ...(customization.platform_overrides
      ? { platform_overrides: customization.platform_overrides }
      : {}),
    platform_customized_at: new Date().toISOString(),
  };
}

/**
 * Describe what changed between the default template and the org's customization.
 * Useful for showing a summary of customizations in the admin UI.
 */
export function describeCustomizations(
  overrides: TemplateOverrides,
): { section: string; label: string }[] {
  const changes: { section: string; label: string }[] = [];

  if (overrides.capabilityFlags) {
    const flags = overrides.capabilityFlags;
    for (const [key, value] of Object.entries(flags)) {
      if (typeof value === 'boolean') {
        changes.push({
          section: 'Capabilities',
          label: `${formatFlag(key)}: ${value ? 'enabled' : 'disabled'}`,
        });
      }
    }
  }

  if (overrides.queuePolicy) {
    changes.push({ section: 'Queue Policy', label: 'Queue settings customized' });
  }

  if (overrides.workflowProfile) {
    changes.push({ section: 'Workflow', label: 'Workflow settings customized' });
  }

  if (overrides.experienceProfile) {
    const exp = overrides.experienceProfile;
    if (exp.vocabulary) changes.push({ section: 'Experience', label: 'Custom vocabulary' });
    if (exp.kiosk) changes.push({ section: 'Experience', label: 'Kiosk customized' });
    if (exp.branding) changes.push({ section: 'Experience', label: 'Branding customized' });
    if (exp.messagingTone) changes.push({ section: 'Experience', label: `Tone: ${exp.messagingTone}` });
  }

  return changes;
}

function formatFlag(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
