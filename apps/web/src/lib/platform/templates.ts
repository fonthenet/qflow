/**
 * Industry templates — the 5 pre-built business configurations.
 *
 * Each template is composed using the factory:
 *   createTemplate({ tier, vertical, version, overlay })
 *
 * The factory deep-merges a tier preset (light/standard/enterprise)
 * with a vertical-specific overlay to produce the full IndustryTemplate.
 *
 * To add a new template:
 *   1. Create an overlay function in vertical-overlays.ts
 *   2. Add a createTemplate() call here
 *   3. That's it — the tier preset handles all the boilerplate
 */

import type { IndustryTemplate, TemplateMigration, TemplateVersionChange } from '@qflo/shared';
import { createTemplate } from './template-factory';
import {
  getPublicServiceOverlay,
  getBankBranchOverlay,
  getClinicOverlay,
  getRestaurantOverlay,
  getBarbershopOverlay,
} from './vertical-overlays';

// ── Helpers ─────────────────────────────────────────────────────────────────

function migrationChange(
  id: string,
  section: TemplateVersionChange['section'],
  impact: TemplateVersionChange['impact'],
  title: string,
  description: string,
  recommendedAction?: string,
): TemplateVersionChange {
  return { id, section, impact, title, description, recommendedAction };
}

function versionMetadata(
  current: string,
  previous: string[],
  notes: string,
  migrations: TemplateMigration[],
) {
  return { current, previous, updatedAt: '2026-03-15', notes, migrations };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEMPLATE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const industryTemplates: IndustryTemplate[] = [
  // ── Public Service (enterprise tier) ──────────────────────────────────
  createTemplate({
    id: 'public-service',
    title: 'Public Service Branch',
    vertical: 'public_service',
    tier: 'enterprise',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Canonical structured ticket flow with stronger self-service defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves queue resilience and kiosk pacing for public-service branches.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange('public-service-kiosk-timeout', 'experience_profile', 'safe', 'Longer kiosk idle timeout', 'Kiosk idle timeout increases from 60 to 75 seconds to reduce unintended resets.'),
          migrationChange('public-service-no-show-window', 'workflow_profile', 'review_required', 'Adjusted no-show timeout', 'The no-show timeout increases from 10 to 12 minutes to better match high-volume public counters.', 'Review whether branch staffing can tolerate the longer grace period.'),
          migrationChange('public-service-capacity', 'queue_policy', 'safe', 'Higher queue capacity default', 'Default queue capacity increases from 120 to 140 customers.'),
        ],
      },
    ]),
    overlay: getPublicServiceOverlay(),
  }),

  // ── Bank Branch (enterprise tier) ─────────────────────────────────────
  createTemplate({
    id: 'bank-branch',
    title: 'Bank Branch',
    vertical: 'bank',
    tier: 'enterprise',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Appointments plus service routing with clearer lobby pacing.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Refines branch capacity and privacy defaults for mixed teller/advisory traffic.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange('bank-capacity', 'queue_policy', 'safe', 'Higher branch capacity default', 'Capacity increases from 80 to 90 to better reflect larger mixed-service branches.'),
          migrationChange('bank-display-next-up', 'experience_profile', 'review_required', 'More privacy-conscious display layout', 'The public display stops showing next-up by default in order to reduce lobby exposure.', 'Review whether your branch still wants pre-call visibility on the display.'),
          migrationChange('bank-no-show-window', 'workflow_profile', 'safe', 'Slightly longer appointment grace period', 'No-show timeout increases from 8 to 10 minutes.'),
        ],
      },
    ]),
    overlay: getBankBranchOverlay(),
  }),

  // ── Clinic (standard tier) ────────────────────────────────────────────
  createTemplate({
    id: 'clinic',
    title: 'Clinic',
    vertical: 'clinic',
    tier: 'standard',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Privacy-aware clinic flow with stronger triage and accessibility defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves clinic handoff behavior and multilingual support.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange('clinic-language-support', 'experience_profile', 'safe', 'Expanded supported languages', 'French is added to the supported language list for clinics with multilingual intake.'),
          migrationChange('clinic-capacity', 'queue_policy', 'review_required', 'Reduced default capacity', 'Capacity decreases from 60 to 50 to better reflect privacy-aware waiting rooms.', 'Review waiting room throughput before adopting the lower capacity.'),
          migrationChange('clinic-recall-policy', 'workflow_profile', 'safe', 'Shorter recall limit', 'Maximum recalls decreases from 3 to 2 to keep check-in lanes moving.'),
        ],
      },
    ]),
    overlay: getClinicOverlay(),
  }),

  // ── Restaurant Waitlist (light tier) ──────────────────────────────────
  createTemplate({
    id: 'restaurant-waitlist',
    title: 'Restaurant Waitlist',
    vertical: 'restaurant',
    tier: 'light',
    version: versionMetadata('1.2.0', ['1.1.0', '1.0.0'], 'Host-stand waitlist with reservation-ready defaults and staff-controlled seating decisions.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-10',
        summary: 'Improves host-stand defaults and waitlist capacity.',
        officeRolloutRecommended: false,
        changes: [
          migrationChange('restaurant-capacity-bump', 'queue_policy', 'safe', 'Higher default waitlist capacity', 'Capacity increases from 40 to 50 guests.'),
        ],
      },
      {
        fromVersion: '1.1.0',
        toVersion: '1.2.0',
        releasedAt: '2026-03-16',
        summary: 'Adds staff-controlled seating preferences, reservation-ready intake, and clearer host workflow defaults.',
        officeRolloutRecommended: false,
        changes: [
          migrationChange('restaurant-reservations', 'workflow_profile', 'review_required', 'Reservations can share the host flow', 'The restaurant template now assumes reservations and walk-ins can be managed from one host queue.', 'Review whether your host stand wants reservation arrival handled in the same screen as walk-ins.'),
          migrationChange('restaurant-intake', 'experience_profile', 'safe', 'Guests provide party details instead of choosing tables', 'The public flow now emphasizes party size and seating preference rather than table-like options.'),
          migrationChange('restaurant-host-controls', 'queue_policy', 'safe', 'Richer host workflow metadata', 'Starter offices now include seating zones, table presets, hold windows, and manual host assignment defaults.'),
        ],
      },
    ]),
    overlay: getRestaurantOverlay(),
  }),

  // ── Barbershop / Salon (light tier) ───────────────────────────────────
  createTemplate({
    id: 'barbershop',
    title: 'Barbershop / Salon',
    vertical: 'barbershop',
    tier: 'light',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Named-client waitlist with stronger staff-preference defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves small-shop throughput and client communication defaults.',
        officeRolloutRecommended: false,
        changes: [
          migrationChange('barbershop-capacity', 'queue_policy', 'safe', 'Higher waitlist capacity', 'Capacity increases from 35 to 40 clients.'),
          migrationChange('barbershop-remote-join-copy', 'queue_policy', 'review_required', 'Updated remote join messaging', 'Remote join notice is rewritten to encourage clients to return closer to chair availability.', 'Review the copy if the shop prefers a more casual tone.'),
        ],
      },
    ]),
    overlay: getBarbershopOverlay(),
  }),
];

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API (unchanged — backward compatible)
// ═══════════════════════════════════════════════════════════════════════════

export function getIndustryTemplateById(templateId: string | null | undefined) {
  return industryTemplates.find((template) => template.id === templateId) ?? industryTemplates[0];
}

export function getTemplateOptions() {
  return industryTemplates.map((template) => ({
    id: template.id,
    title: template.title,
    vertical: template.vertical,
    tier: template.tier,
    dashboardMode: template.dashboardMode,
    enabledModules: template.enabledModules,
    onboardingCopy: template.onboardingCopy,
    recommendedRoles: template.recommendedRoles,
    branchTypes: template.starterOffices.map((office) => office.branchType),
  }));
}
