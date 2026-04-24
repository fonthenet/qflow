/**
 * Template factory — composes IndustryTemplate objects from tier presets + vertical overlays.
 *
 * Usage:
 *   createTemplate({
 *     id: 'barbershop',
 *     title: 'Barbershop / Salon',
 *     vertical: 'barbershop',
 *     tier: 'light',
 *     version: versionMetadata(...),
 *     overlay: getBarbershopOverlay(),
 *   })
 *
 * The factory deep-merges: tier preset → vertical overlay → explicit overrides.
 */

import { deepMergeRecords, type IndustryTemplate, type TemplateTier, type IndustryVertical, type TemplateVersion } from '@qflo/shared';
import { getTierPreset } from './template-base';

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? T[P]  // don't recurse into arrays
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

export interface TemplateFactoryInput {
  id: string;
  title: string;
  vertical: IndustryVertical;
  tier: TemplateTier;
  version: TemplateVersion;
  /** Vertical-specific overlay (vocabulary, starter offices, kiosk copy, etc.) */
  overlay: DeepPartial<IndustryTemplate>;
}

/**
 * Create an IndustryTemplate by composing tier defaults with a vertical overlay.
 *
 * Merge order: tier preset (base) → overlay (vertical-specific customization)
 * Arrays in the overlay REPLACE the tier default (not concatenated).
 */
export function createTemplate(input: TemplateFactoryInput): IndustryTemplate {
  const preset = getTierPreset(input.tier);

  // Start with the tier preset as the base template
  const base: IndustryTemplate = {
    id: input.id,
    title: input.title,
    vertical: input.vertical,
    tier: input.tier,
    version: input.version,
    dashboardMode: preset.experienceProfile.dashboardMode,
    defaultNavigation: preset.defaultNavigation,
    enabledModules: preset.enabledModules,
    onboardingCopy: {
      headline: `Launch your ${input.title.toLowerCase()}`,
      description: '',
      reviewChecklist: [],
    },
    recommendedRoles: preset.recommendedRoles as any,
    defaultSlas: preset.defaultSlas,
    capabilityFlags: preset.capabilityFlags,
    workflowProfile: preset.workflowProfile,
    queuePolicy: preset.queuePolicy,
    experienceProfile: preset.experienceProfile,
    rolePolicy: preset.rolePolicy,
    starterPriorities: preset.starterPriorities,
    starterOffices: [],
    intakeSchemas: [],
  };

  // Deep-merge the overlay onto the base
  // For arrays (starterOffices, intakeSchemas, etc.), overlay replaces entirely
  const overlay = input.overlay;

  const merged = deepMergeRecords(
    base as unknown as Record<string, unknown>,
    overlay as unknown as Record<string, unknown>,
  ) as unknown as IndustryTemplate;

  // Ensure arrays from overlay replace rather than getting mangled by deepMerge
  if (overlay.starterOffices) merged.starterOffices = overlay.starterOffices as any;
  if (overlay.intakeSchemas) merged.intakeSchemas = overlay.intakeSchemas as any;
  if (overlay.starterPriorities) merged.starterPriorities = overlay.starterPriorities as any;
  if (overlay.defaultSlas) merged.defaultSlas = overlay.defaultSlas as any;
  if (overlay.defaultNavigation) merged.defaultNavigation = overlay.defaultNavigation as any;
  if (overlay.enabledModules) merged.enabledModules = overlay.enabledModules as any;
  if (overlay.recommendedRoles) merged.recommendedRoles = overlay.recommendedRoles as any;
  // deepMergeRecords treats arrays atomically: an overlay supplying rolePolicy.roles: []
  // would silently wipe the tier's role list and collapse every admin sidebar to ['/desk'].
  // If the overlay doesn't provide non-empty roles, keep the tier preset's rolePolicy intact.
  if (!overlay.rolePolicy || !overlay.rolePolicy.roles || (overlay.rolePolicy.roles as any[]).length === 0) {
    merged.rolePolicy = preset.rolePolicy;
  }
  if (overlay.onboardingCopy?.reviewChecklist) {
    merged.onboardingCopy.reviewChecklist = overlay.onboardingCopy.reviewChecklist;
  }
  if (overlay.experienceProfile?.supportedLanguages) {
    merged.experienceProfile.supportedLanguages = overlay.experienceProfile.supportedLanguages;
  }

  // Preserve id/title/vertical/tier/version (never overridden by overlay)
  merged.id = input.id;
  merged.title = input.title;
  merged.vertical = input.vertical;
  merged.tier = input.tier;
  merged.version = input.version;

  return merged;
}
