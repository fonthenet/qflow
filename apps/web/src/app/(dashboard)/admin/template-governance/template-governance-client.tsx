'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TemplateLifecycleState } from '@qflo/shared';
import {
  AlertTriangle,
  Clock3,
  CheckCircle2,
  GitBranchPlus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  rolloutIndustryTemplateToOffices,
  upgradeIndustryTemplateSettings,
} from '@/lib/actions/platform-actions';
import { useI18n } from '@/components/providers/locale-provider';
import type {
  TemplateGovernanceReport,
  TemplateUpgradeStrategy,
} from '@/lib/platform/governance';

interface TemplateGovernanceClientProps {
  organization: {
    id: string;
    name: string;
  };
  lifecycleState?: TemplateLifecycleState;
  existingOfficeCount?: number;
  templateSummary: {
    id: string;
    title: string;
    vertical: string;
    version: string;
    dashboardMode: string;
    operatingModel: string;
    branchType: string;
    enabledModules: string[];
    recommendedRoles: string[];
  };
  governanceReport: TemplateGovernanceReport;
}

const STRATEGY_OPTIONS: { value: TemplateUpgradeStrategy; label: string; description: string }[] = [
  {
    value: 'keep_current',
    label: 'Keep Current',
    description: 'Preserve the current effective values for this section during the template refresh.',
  },
  {
    value: 'adopt_defaults',
    label: 'Adopt Defaults',
    description: 'Reset this section to the latest template defaults.',
  },
];

function impactBadgeClasses(impact: 'safe' | 'review_required' | 'breaking') {
  if (impact === 'safe') {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (impact === 'breaking') {
    return 'bg-red-100 text-red-700';
  }

  return 'bg-amber-100 text-amber-700';
}

function formatTimestamp(
  value: string | null,
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
) {
  if (!value) {
    return null;
  }

  return formatDateTime(value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSectionLabel(value: string) {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function summarizeSectionStrategies(
  strategies: Record<string, string>,
  t: (key: string, variables?: Record<string, string | number>) => string
) {
  const entries = Object.entries(strategies);

  if (entries.length === 0) {
    return t('No section overrides were recorded for this action.');
  }

  return entries
    .map(([key, value]) => {
      const strategyLabel = value === 'adopt_defaults' ? t('Adopt defaults') : t('Keep current');
      return `${formatSectionLabel(key)}: ${strategyLabel}`;
    })
    .join(' · ');
}

export function TemplateGovernanceClient({
  organization,
  lifecycleState = 'template_confirmed',
  existingOfficeCount = 0,
  templateSummary,
  governanceReport,
}: TemplateGovernanceClientProps) {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const [isUpgradePending, startUpgradeTransition] = useTransition();
  const [isRolloutPending, startRolloutTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<Record<string, TemplateUpgradeStrategy>>(() =>
    Object.fromEntries(
      governanceReport.organizationSections.map((section) => [
        section.key,
        section.driftCount > 0 ? 'keep_current' : 'adopt_defaults',
      ])
    )
  );
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>(() =>
    governanceReport.officeReports
      .filter((office) => office.isUpgradeAvailable || office.driftCount > 0)
      .map((office) => office.officeId)
  );

  const selectedDefaultResets = useMemo(
    () => Object.values(strategies).filter((value) => value === 'adopt_defaults').length,
    [strategies]
  );

  function updateStrategy(sectionKey: string, strategy: TemplateUpgradeStrategy) {
    setStrategies((current) => ({
      ...current,
      [sectionKey]: strategy,
    }));
  }

  function toggleOfficeSelection(officeId: string) {
    setSelectedOfficeIds((current) =>
      current.includes(officeId)
        ? current.filter((id) => id !== officeId)
        : [...current, officeId]
    );
  }

  function selectAllRolloutCandidates() {
    setSelectedOfficeIds(
      governanceReport.officeReports
        .filter((office) => office.isUpgradeAvailable || office.driftCount > 0)
        .map((office) => office.officeId)
    );
  }

  function handleApplyUpgrade() {
    setSuccessMessage(null);
    setErrorMessage(null);

    startUpgradeTransition(async () => {
      const result = await upgradeIndustryTemplateSettings({
        sectionStrategies: strategies,
      });

      if (result?.error) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage(
        t('Template governance applied. Organization drift is now {count}.', {
          count: result?.data?.organizationDriftCount ?? 0,
        })
      );
      router.refresh();
    });
  }

  function handleOfficeRollout() {
    setSuccessMessage(null);
    setErrorMessage(null);

    startRolloutTransition(async () => {
      const result = await rolloutIndustryTemplateToOffices({
        officeIds: selectedOfficeIds,
        sectionStrategies: strategies,
      });

      if (result?.error) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage(
        t('Rolled template changes to {count} office(s).', {
          count: result?.data?.updatedOffices ?? 0,
        })
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Setup Updates')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Review recommended setup changes without touching live bookings or alerts.')}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-5 py-4 text-sm">
          <p className="font-semibold text-foreground">{organization.name}</p>
          <p className="text-muted-foreground">
            {templateSummary.title} · v{governanceReport.appliedVersion}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-primary/15 bg-primary/5 px-5 py-4 text-sm text-slate-700">
        <p className="font-semibold text-foreground">
          {lifecycleState === 'template_confirmed'
            ? t('Your setup is locked in')
            : t('Preview mode is still active')}
        </p>
        <p className="mt-1">
          {lifecycleState === 'template_confirmed'
            ? t('This business has {count} live location(s). You can review safe updates here, but you cannot switch the whole business model after launch.', {
                count: existingOfficeCount,
              })
            : t('Finish your setup preview first. Once you confirm it, this page becomes your safe place for later updates.')}
        </p>
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Update status')}
          </p>
          <p className="mt-2 text-lg font-semibold text-foreground">
            {governanceReport.isUpgradeAvailable ? t('Ready to review') : t('Up to date')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Current v{applied} · Latest v{latest}', {
              applied: governanceReport.appliedVersion,
              latest: governanceReport.latestVersion,
            })}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Low-risk changes')}
          </p>
          <p className="mt-2 text-3xl font-bold text-foreground">{governanceReport.safeChangeCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('Changes you can usually roll out with confidence.')}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Locations to review')}
          </p>
          <p className="mt-2 text-3xl font-bold text-foreground">
            {governanceReport.officesBehindCount}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Locations still waiting for the latest approved setup version.')}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">{t("What's new")}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Review the most important changes before you roll anything out.')}
        </p>

        {governanceReport.migrationReports.length > 0 ? (
          <div className="mt-5 space-y-4">
            {governanceReport.migrationReports.map((migration) => (
              <div key={`${migration.fromVersion}-${migration.toVersion}`} className="rounded-2xl border border-border bg-muted/20 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-base font-semibold text-foreground">
                      v{migration.fromVersion} to v{migration.toVersion}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{migration.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('Released {date}', { date: migration.releasedAt })}
                      {migration.officeRolloutRecommended ? ` ${t('· Good candidate for location rollout')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {t('{count} safe', { count: migration.safeChanges })}
                    </span>
                    {migration.breakingChanges > 0 && (
                      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                        {t('{count} breaking', { count: migration.breakingChanges })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {migration.changes.slice(0, 4).map((change) => (
                    <div key={change.id} className="rounded-xl border border-border bg-background px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{change.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{change.description}</p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${impactBadgeClasses(change.impact)}`}
                        >
                          {t(change.impact.replace(/_/g, ' '))}
                        </span>
                      </div>
                      {change.recommendedAction && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t('Suggested next step: {action}', { action: change.recommendedAction })}
                        </p>
                      )}
                    </div>
                  ))}
                  {migration.changes.length > 4 && (
                    <p className="px-1 text-xs text-muted-foreground">
                      {t('+{count} more changes in this release', { count: migration.changes.length - 4 })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t('No pending template changes. This organization is already on the latest reviewed version.')}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">{t('Keep your custom choices')}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Only review the parts of the setup where your team already made custom changes.')}
            </p>
          </div>
          <Link
            href="/admin/onboarding"
            className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            {t('Back to Setup')}
          </Link>
        </div>

        <div className="mt-6 space-y-4">
          {governanceReport.organizationSections
            .filter((section) => section.driftCount > 0)
            .map((section) => (
            <div key={section.key} className="rounded-2xl border border-border bg-muted/20 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{section.label}</h3>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        section.driftCount > 0
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {section.driftCount > 0
                        ? t('{count} custom changes', { count: section.driftCount })
                        : t('Matches default')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('{count} saved custom setting(s) in this area.', { count: section.driftCount })}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {STRATEGY_OPTIONS.map((option) => {
                    const isSelected = strategies[section.key] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateStrategy(section.key, option.value)}
                        aria-label={`${section.label} ${t(option.label)}`}
                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                      >
                        <p className="text-sm font-semibold text-foreground">{option.label === 'Keep Current' ? t('Keep what we use today') : t('Use the new default')}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t(option.description)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          {governanceReport.organizationSections.filter((section) => section.driftCount > 0).length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t('No business-wide custom changes need a decision right now.')}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end">
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {t('{count} section(s) set to adopt defaults', { count: selectedDefaultResets })}
            </p>
            <button
              type="button"
              onClick={handleApplyUpgrade}
              disabled={isUpgradePending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isUpgradePending ? 'animate-spin' : ''}`} />
              {isUpgradePending ? t('Saving...') : t('Save choices')}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('Recent changes')}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Track recent business-wide updates and location rollouts.')}
          </p>

          {governanceReport.migrationHistory.length > 0 || governanceReport.officeRolloutHistory.length > 0 ? (
            <div className="mt-5 space-y-3">
              {governanceReport.migrationHistory.slice(0, 3).map((entry) => (
                <div
                  key={`${entry.appliedAt}-${entry.fromVersion}-${entry.toVersion}`}
                  className="rounded-xl border border-border bg-muted/20 p-4"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {t('Business updated from v{from} to v{to}', {
                      from: entry.fromVersion,
                      to: entry.toVersion,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(entry.appliedAt, formatDateTime) ?? t('Not recorded yet')} · {summarizeSectionStrategies(entry.sectionStrategies, t)}
                  </p>
                </div>
              ))}
              {governanceReport.officeRolloutHistory.slice(0, 8).map((entry) => (
                <div
                  key={`${entry.officeId}-${entry.rolledOutAt}-${entry.toVersion}`}
                  className="rounded-xl border border-border bg-muted/20 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{entry.officeName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('Rolled from v{from} to v{to} · {date}', {
                          from: entry.fromVersion,
                          to: entry.toVersion,
                          date: formatTimestamp(entry.rolledOutAt, formatDateTime) ?? t('Not recorded yet'),
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t('No rollout activity has been recorded yet.')}
            </div>
          )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitBranchPlus className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">{t('Office Rollout')}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Roll the reviewed template version out to individual branches. Selected section strategies will be reused for the rollout.')}
            </p>
          </div>
          <button
            type="button"
            onClick={selectAllRolloutCandidates}
            className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            {t('Select All Candidates')}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {governanceReport.officeReports.length > 0 ? (
            governanceReport.officeReports.map((office) => (
              <label
                key={office.officeId}
                className="flex cursor-pointer gap-4 rounded-xl border border-border bg-muted/20 p-4"
              >
                <input
                  type="checkbox"
                  checked={selectedOfficeIds.includes(office.officeId)}
                  onChange={() => toggleOfficeSelection(office.officeId)}
                  aria-label={t('Select office {name}', { name: office.officeName })}
                  className="mt-1 h-4 w-4 rounded border-border"
                />
                <div className="flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{office.officeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('Applied v{applied} · Latest v{latest}', {
                          applied: office.appliedVersion,
                          latest: office.latestVersion,
                        })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {office.rolloutCount > 0
                          ? t('{count} rollout(s) · Last {date}', {
                              count: office.rolloutCount,
                              date: formatTimestamp(office.lastRolledOutAt, formatDateTime) ?? t('Not recorded yet'),
                            })
                          : t('No rollout history recorded yet.')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          office.isUpgradeAvailable
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {office.isUpgradeAvailable ? t('Upgrade pending') : t('Version current')}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          office.driftCount > 0
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {office.driftCount > 0 ? t('{count} drift paths', { count: office.driftCount }) : t('Aligned')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {office.sections
                      .filter((section) => section.driftCount > 0)
                      .map((section) => (
                        <span
                          key={section.key}
                          className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground"
                        >
                          {section.label}: {section.driftCount}
                        </span>
                      ))}

                    {office.driftCount === 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t('No office-level drift detected.')}
                      </span>
                    )}
                  </div>
                </div>
              </label>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t('No offices found yet.')}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('{count} office(s) selected', { count: selectedOfficeIds.length })}
          </p>
          <button
            type="button"
            onClick={handleOfficeRollout}
            disabled={isRolloutPending || selectedOfficeIds.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <GitBranchPlus className={`h-4 w-4 ${isRolloutPending ? 'animate-pulse' : ''}`} />
            {isRolloutPending ? t('Rolling Out...') : t('Roll Out To Selected Offices')}
          </button>
        </div>
      </section>
    </div>
  );
}
