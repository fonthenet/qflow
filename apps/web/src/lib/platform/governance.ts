import type {
  CapabilityFlags,
  ExperienceProfile,
  IndustryTemplate,
  QueuePolicy,
  ResolvedPlatformConfig,
  RolePolicy,
  TemplateChangeImpact,
  TemplateMigration,
  TemplateSectionKey,
  WorkflowProfile,
} from '@qflo/shared';
import { resolvePlatformConfig } from './config';

type UnknownRecord = Record<string, unknown>;
type PlatformSectionValue =
  | CapabilityFlags
  | WorkflowProfile
  | QueuePolicy
  | ExperienceProfile
  | RolePolicy;

export type TemplateUpgradeStrategy = 'keep_current' | 'adopt_defaults';

export interface TemplateDriftSectionReport {
  key: TemplateSectionKey;
  label: string;
  settingsKey: string;
  driftCount: number;
  driftPaths: string[];
}

export interface TemplateDriftOfficeReport {
  officeId: string;
  officeName: string;
  appliedVersion: string;
  latestVersion: string;
  isUpgradeAvailable: boolean;
  driftCount: number;
  sections: TemplateDriftSectionReport[];
  rolloutCount: number;
  lastRolledOutAt: string | null;
  rolloutHistory: OfficeRolloutHistoryEntry[];
}

export interface TemplateMigrationReport {
  fromVersion: string;
  toVersion: string;
  releasedAt: string;
  summary: string;
  officeRolloutRecommended: boolean;
  changes: TemplateMigration['changes'];
  safeChanges: number;
  reviewRequiredChanges: number;
  breakingChanges: number;
}

export interface TemplateMigrationHistoryEntry {
  appliedAt: string;
  fromVersion: string;
  toVersion: string;
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
  migrationCount: number;
  safeChangeCount: number;
  reviewRequiredChangeCount: number;
  breakingChangeCount: number;
}

export interface OfficeRolloutHistoryEntry {
  officeId: string;
  officeName: string;
  rolledOutAt: string;
  fromVersion: string;
  toVersion: string;
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
}

export interface TemplateHealthSummary {
  officeCount: number;
  officesCurrentCount: number;
  officesBehindCount: number;
  officesWithDrift: number;
  currentVersionCoveragePercent: number;
  branchAlignmentPercent: number;
  organizationMigrationCount: number;
  officeRolloutCount: number;
  lastMigrationAt: string | null;
  lastOfficeRolloutAt: string | null;
}

export interface TemplateGovernanceReport {
  templateId: string;
  templateTitle: string;
  appliedVersion: string;
  latestVersion: string;
  isUpgradeAvailable: boolean;
  safeChangeCount: number;
  reviewRequiredChangeCount: number;
  breakingChangeCount: number;
  migrationReports: TemplateMigrationReport[];
  organizationDriftCount: number;
  organizationSections: TemplateDriftSectionReport[];
  officeDriftCount: number;
  officesWithDrift: number;
  officesBehindCount: number;
  migrationHistory: TemplateMigrationHistoryEntry[];
  officeRolloutHistory: OfficeRolloutHistoryEntry[];
  healthSummary: TemplateHealthSummary;
  officeReports: TemplateDriftOfficeReport[];
}

interface OfficeSettingsRow {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
}

interface PlatformSectionDefinition {
  key: TemplateSectionKey;
  label: string;
  settingsKey: string;
  getTemplateValue: (template: IndustryTemplate) => PlatformSectionValue;
  getResolvedValue: (config: ResolvedPlatformConfig) => PlatformSectionValue;
}

const PLATFORM_SECTION_DEFINITIONS: PlatformSectionDefinition[] = [
  {
    key: 'capability_flags',
    label: 'Capabilities',
    settingsKey: 'platform_capability_overrides',
    getTemplateValue: (template) => template.capabilityFlags,
    getResolvedValue: (config) => config.capabilityFlags,
  },
  {
    key: 'workflow_profile',
    label: 'Workflow Profile',
    settingsKey: 'platform_workflow_profile',
    getTemplateValue: (template) => template.workflowProfile,
    getResolvedValue: (config) => config.workflowProfile,
  },
  {
    key: 'queue_policy',
    label: 'Queue Policy',
    settingsKey: 'platform_queue_policy',
    getTemplateValue: (template) => template.queuePolicy,
    getResolvedValue: (config) => config.queuePolicy,
  },
  {
    key: 'experience_profile',
    label: 'Experience Profile',
    settingsKey: 'platform_experience_profile',
    getTemplateValue: (template) => template.experienceProfile,
    getResolvedValue: (config) => config.experienceProfile,
  },
  {
    key: 'role_policy',
    label: 'Role Policy',
    settingsKey: 'platform_role_policy',
    getTemplateValue: (template) => template.rolePolicy,
    getResolvedValue: (config) => config.rolePolicy,
  },
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUpgradeStrategy(value: unknown): value is TemplateUpgradeStrategy {
  return value === 'keep_current' || value === 'adopt_defaults';
}

function getTimestampValue(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function sortTimestampsDescending<T>(entries: T[], getTimestamp: (entry: T) => string) {
  return [...entries].sort(
    (left, right) => Date.parse(getTimestamp(right)) - Date.parse(getTimestamp(left))
  );
}

function getStrategyMap(value: unknown): Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>> {
  if (!isRecord(value)) {
    return {};
  }

  const strategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>> = {};

  for (const definition of PLATFORM_SECTION_DEFINITIONS) {
    const strategyValue = value[definition.key];
    if (isUpgradeStrategy(strategyValue)) {
      strategies[definition.key] = strategyValue;
    }
  }

  return strategies;
}

function getMigrationHistory(settings: unknown): TemplateMigrationHistoryEntry[] {
  if (!isRecord(settings) || !Array.isArray(settings.platform_migration_history)) {
    return [];
  }

  const entries = settings.platform_migration_history.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const appliedAt = getTimestampValue(entry.applied_at);
    const fromVersion = typeof entry.from_version === 'string' ? entry.from_version : null;
    const toVersion = typeof entry.to_version === 'string' ? entry.to_version : null;

    if (!appliedAt || !fromVersion || !toVersion) {
      return [];
    }

    return [
      {
        appliedAt,
        fromVersion,
        toVersion,
        sectionStrategies: getStrategyMap(entry.section_strategies),
        migrationCount:
          typeof entry.migration_count === 'number' ? entry.migration_count : 0,
        safeChangeCount:
          typeof entry.safe_change_count === 'number' ? entry.safe_change_count : 0,
        reviewRequiredChangeCount:
          typeof entry.review_required_change_count === 'number'
            ? entry.review_required_change_count
            : 0,
        breakingChangeCount:
          typeof entry.breaking_change_count === 'number' ? entry.breaking_change_count : 0,
      },
    ];
  });

  return sortTimestampsDescending(entries, (entry) => entry.appliedAt);
}

function getOfficeRolloutHistory(
  settings: unknown,
  officeId: string,
  officeName: string
): OfficeRolloutHistoryEntry[] {
  if (!isRecord(settings) || !Array.isArray(settings.platform_rollout_history)) {
    return [];
  }

  const entries = settings.platform_rollout_history.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const rolledOutAt = getTimestampValue(entry.rolled_out_at);
    const fromVersion = typeof entry.from_version === 'string' ? entry.from_version : null;
    const toVersion = typeof entry.to_version === 'string' ? entry.to_version : null;

    if (!rolledOutAt || !fromVersion || !toVersion) {
      return [];
    }

    return [
      {
        officeId,
        officeName,
        rolledOutAt,
        fromVersion,
        toVersion,
        sectionStrategies: getStrategyMap(entry.section_strategies),
      },
    ];
  });

  return sortTimestampsDescending(entries, (entry) => entry.rolledOutAt);
}

function compareValues(baseValue: unknown, candidateValue: unknown, path: string): string[] {
  if (Array.isArray(baseValue) || Array.isArray(candidateValue)) {
    return JSON.stringify(baseValue) === JSON.stringify(candidateValue) ? [] : [path];
  }

  if (isRecord(baseValue) && isRecord(candidateValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(candidateValue)]);
    const driftPaths: string[] = [];

    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      driftPaths.push(...compareValues(baseValue[key], candidateValue[key], nextPath));
    }

    return driftPaths;
  }

  return Object.is(baseValue, candidateValue) ? [] : [path];
}

function buildSectionReport(
  definition: PlatformSectionDefinition,
  baseValue: PlatformSectionValue,
  candidateValue: PlatformSectionValue
): TemplateDriftSectionReport {
  const driftPaths = compareValues(baseValue, candidateValue, '');

  return {
    key: definition.key,
    label: definition.label,
    settingsKey: definition.settingsKey,
    driftCount: driftPaths.length,
    driftPaths,
  };
}

function getAppliedVersion(settings: unknown, fallbackVersion: string) {
  const record = isRecord(settings) ? settings : {};
  return typeof record.platform_template_version === 'string'
    ? record.platform_template_version
    : fallbackVersion;
}

function buildMigrationReport(migration: TemplateMigration): TemplateMigrationReport {
  const countImpact = (impact: TemplateChangeImpact) =>
    migration.changes.filter((change) => change.impact === impact).length;

  return {
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    releasedAt: migration.releasedAt,
    summary: migration.summary,
    officeRolloutRecommended: migration.officeRolloutRecommended,
    changes: migration.changes,
    safeChanges: countImpact('safe'),
    reviewRequiredChanges: countImpact('review_required'),
    breakingChanges: countImpact('breaking'),
  };
}

function getMigrationPath(
  template: IndustryTemplate,
  appliedVersion: string,
  latestVersion: string
): TemplateMigrationReport[] {
  if (appliedVersion === latestVersion) {
    return [];
  }

  const reports: TemplateMigrationReport[] = [];
  const migrations = template.version.migrations ?? [];
  let cursor = appliedVersion;
  let safetyCounter = 0;

  while (cursor !== latestVersion && safetyCounter < 10) {
    const nextMigration = migrations.find((migration) => migration.fromVersion === cursor);

    if (!nextMigration) {
      break;
    }

    reports.push(buildMigrationReport(nextMigration));
    cursor = nextMigration.toVersion;
    safetyCounter += 1;
  }

  return reports;
}

export function buildTemplateGovernanceReport(input: {
  organizationSettings: unknown;
  offices?: OfficeSettingsRow[];
}): TemplateGovernanceReport {
  const organizationConfig = resolvePlatformConfig({
    organizationSettings: input.organizationSettings,
  });
  const latestVersion = organizationConfig.template.version.current;
  const organizationAppliedVersion = getAppliedVersion(
    input.organizationSettings,
    organizationConfig.selection.version
  );

  const organizationSections = PLATFORM_SECTION_DEFINITIONS.map((definition) =>
    buildSectionReport(
      definition,
      definition.getTemplateValue(organizationConfig.template),
      definition.getResolvedValue(organizationConfig)
    )
  );

  const migrationReports = getMigrationPath(
    organizationConfig.template,
    organizationAppliedVersion,
    latestVersion
  );
  const migrationHistory = getMigrationHistory(input.organizationSettings);

  const officeReports = (input.offices ?? []).map((office) => {
    const officeConfig = resolvePlatformConfig({
      organizationSettings: input.organizationSettings,
      officeSettings: office.settings ?? {},
    });
    const officeAppliedVersion = getAppliedVersion(office.settings, organizationAppliedVersion);
    const rolloutHistory = getOfficeRolloutHistory(office.settings, office.id, office.name);

    const sections = PLATFORM_SECTION_DEFINITIONS.map((definition) =>
      buildSectionReport(
        definition,
        definition.getResolvedValue(organizationConfig),
        definition.getResolvedValue(officeConfig)
      )
    );

    return {
      officeId: office.id,
      officeName: office.name,
      appliedVersion: officeAppliedVersion,
      latestVersion,
      isUpgradeAvailable: officeAppliedVersion !== latestVersion,
      driftCount: sections.reduce((total, section) => total + section.driftCount, 0),
      sections,
      rolloutCount: rolloutHistory.length,
      lastRolledOutAt: rolloutHistory[0]?.rolledOutAt ?? null,
      rolloutHistory,
    };
  });

  const officesBehindCount = officeReports.filter((office) => office.appliedVersion !== latestVersion).length;
  const officeRolloutHistory = sortTimestampsDescending(
    officeReports.flatMap((office) => office.rolloutHistory),
    (entry) => entry.rolledOutAt
  );
  const officeCount = officeReports.length;
  const officesCurrentCount = officeReports.filter((office) => !office.isUpgradeAvailable).length;
  const officesWithDrift = officeReports.filter((office) => office.driftCount > 0).length;
  const healthSummary: TemplateHealthSummary = {
    officeCount,
    officesCurrentCount,
    officesBehindCount,
    officesWithDrift,
    currentVersionCoveragePercent:
      officeCount > 0 ? Math.round((officesCurrentCount / officeCount) * 100) : 0,
    branchAlignmentPercent:
      officeCount > 0 ? Math.round(((officeCount - officesWithDrift) / officeCount) * 100) : 0,
    organizationMigrationCount: migrationHistory.length,
    officeRolloutCount: officeRolloutHistory.length,
    lastMigrationAt: migrationHistory[0]?.appliedAt ?? null,
    lastOfficeRolloutAt: officeRolloutHistory[0]?.rolledOutAt ?? null,
  };

  return {
    templateId: organizationConfig.template.id,
    templateTitle: organizationConfig.template.title,
    appliedVersion: organizationAppliedVersion,
    latestVersion,
    isUpgradeAvailable: organizationAppliedVersion !== latestVersion,
    safeChangeCount: migrationReports.reduce((total, report) => total + report.safeChanges, 0),
    reviewRequiredChangeCount: migrationReports.reduce(
      (total, report) => total + report.reviewRequiredChanges,
      0
    ),
    breakingChangeCount: migrationReports.reduce(
      (total, report) => total + report.breakingChanges,
      0
    ),
    migrationReports,
    organizationDriftCount: organizationSections.reduce(
      (total, section) => total + section.driftCount,
      0
    ),
    organizationSections,
    officeDriftCount: officeReports.reduce((total, office) => total + office.driftCount, 0),
    officesWithDrift,
    officesBehindCount,
    migrationHistory,
    officeRolloutHistory,
    healthSummary,
    officeReports: officeReports.sort((left, right) => {
      if (right.isUpgradeAvailable !== left.isUpgradeAvailable) {
        return Number(right.isUpgradeAvailable) - Number(left.isUpgradeAvailable);
      }

      return right.driftCount - left.driftCount;
    }),
  };
}

export function buildTemplateUpgradeSettings(input: {
  organizationSettings: unknown;
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
}) {
  const organizationConfig = resolvePlatformConfig({
    organizationSettings: input.organizationSettings,
  });
  const currentSettings = isRecord(input.organizationSettings)
    ? { ...input.organizationSettings }
    : {};
  const nextSettings: Record<string, unknown> = {
    ...currentSettings,
    platform_template_id: organizationConfig.template.id,
    platform_template_version: organizationConfig.template.version.current,
    platform_template_applied_at: new Date().toISOString(),
    platform_vertical: organizationConfig.template.vertical,
    platform_operating_model: organizationConfig.selection.operatingModel,
    platform_branch_type: organizationConfig.selection.branchType,
    platform_enabled_modules: organizationConfig.template.enabledModules,
    platform_default_navigation: organizationConfig.template.defaultNavigation,
    platform_capability_snapshot: organizationConfig.template.capabilityFlags,
  };

  for (const definition of PLATFORM_SECTION_DEFINITIONS) {
    const strategy = input.sectionStrategies[definition.key] ?? 'keep_current';

    nextSettings[definition.settingsKey] =
      strategy === 'adopt_defaults'
        ? definition.getTemplateValue(organizationConfig.template)
        : definition.getResolvedValue(organizationConfig);
  }

  return nextSettings;
}

export function buildOfficeRolloutSettings(input: {
  organizationSettings: unknown;
  officeSettings: unknown;
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
}) {
  const organizationConfig = resolvePlatformConfig({
    organizationSettings: input.organizationSettings,
  });
  const officeConfig = resolvePlatformConfig({
    organizationSettings: input.organizationSettings,
    officeSettings: input.officeSettings,
  });
  const currentOfficeSettings = isRecord(input.officeSettings) ? { ...input.officeSettings } : {};
  const rolloutAt = new Date().toISOString();
  const existingHistory = Array.isArray(currentOfficeSettings.platform_rollout_history)
    ? currentOfficeSettings.platform_rollout_history
    : [];
  const previousVersion = getAppliedVersion(input.officeSettings, organizationConfig.selection.version);
  const nextSettings: Record<string, unknown> = {
    ...currentOfficeSettings,
    platform_template_id: organizationConfig.template.id,
    platform_template_version: organizationConfig.template.version.current,
    platform_template_last_rollout_at: rolloutAt,
    platform_branch_type:
      currentOfficeSettings.platform_branch_type ?? organizationConfig.selection.branchType,
    platform_operating_model:
      currentOfficeSettings.platform_operating_model ?? organizationConfig.selection.operatingModel,
    platform_rollout_history: [
      ...existingHistory,
      {
        rolled_out_at: rolloutAt,
        from_version: previousVersion,
        to_version: organizationConfig.template.version.current,
        section_strategies: input.sectionStrategies,
      },
    ],
  };

  for (const definition of PLATFORM_SECTION_DEFINITIONS) {
    const strategy = input.sectionStrategies[definition.key] ?? 'keep_current';

    if (strategy === 'adopt_defaults') {
      delete nextSettings[definition.settingsKey];
      continue;
    }

    nextSettings[definition.settingsKey] = definition.getResolvedValue(officeConfig);
  }

  return nextSettings;
}
