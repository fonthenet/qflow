'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TemplateLifecycleState } from '@queueflow/shared';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  rolloutIndustryTemplateToOffices,
  upgradeIndustryTemplateSettings,
} from '@/lib/actions/platform-actions';
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
    label: 'Keep current',
    description: 'Preserve your customizations for this section.',
  },
  {
    value: 'adopt_defaults',
    label: 'Use new default',
    description: 'Reset this section to the latest template values.',
  },
];

function impactColor(impact: 'safe' | 'review_required' | 'breaking') {
  if (impact === 'safe') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (impact === 'breaking') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string | null) {
  if (!value) return 'Never';
  return DATE_TIME_FORMATTER.format(new Date(value));
}

function formatSectionLabel(value: string) {
  return value
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function summarizeSectionStrategies(strategies: Record<string, string>) {
  const entries = Object.entries(strategies);
  if (entries.length === 0) return 'No section overrides recorded.';
  return entries
    .map(([key, value]) => `${formatSectionLabel(key)}: ${value === 'adopt_defaults' ? 'Reset' : 'Kept'}`)
    .join(' · ');
}

/* ── Tiny reusable pieces ────────────────────────────────────────────────── */

function VersionBadge({ version, label }: { version: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label && <span className="text-muted-foreground/60">{label}</span>}
      v{version}
    </span>
  );
}

function StatusDot({ status }: { status: 'current' | 'behind' | 'drift' }) {
  const color =
    status === 'current' ? 'bg-emerald-500' : status === 'behind' ? 'bg-amber-500' : 'bg-orange-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

/* ── Main component ──────────────────────────────────────────────────────── */

export function TemplateGovernanceClient({
  organization,
  lifecycleState = 'template_confirmed',
  existingOfficeCount = 0,
  templateSummary,
  governanceReport,
}: TemplateGovernanceClientProps) {
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
  const [expandedMigrations, setExpandedMigrations] = useState<Set<string>>(
    () => new Set(governanceReport.migrationReports.slice(0, 1).map((m) => `${m.fromVersion}-${m.toVersion}`))
  );
  const [showHistory, setShowHistory] = useState(false);

  const selectedDefaultResets = useMemo(
    () => Object.values(strategies).filter((v) => v === 'adopt_defaults').length,
    [strategies]
  );

  const isUpToDate = !governanceReport.isUpgradeAvailable;
  const hasCustomizations = governanceReport.organizationSections.some((s) => s.driftCount > 0);
  const hasHistory = governanceReport.migrationHistory.length > 0 || governanceReport.officeRolloutHistory.length > 0;
  const totalChanges = governanceReport.safeChangeCount + governanceReport.reviewRequiredChangeCount + governanceReport.breakingChangeCount;

  function updateStrategy(sectionKey: string, strategy: TemplateUpgradeStrategy) {
    setStrategies((current) => ({ ...current, [sectionKey]: strategy }));
  }

  function toggleOfficeSelection(officeId: string) {
    setSelectedOfficeIds((current) =>
      current.includes(officeId) ? current.filter((id) => id !== officeId) : [...current, officeId]
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
      const result = await upgradeIndustryTemplateSettings({ sectionStrategies: strategies });
      if (result?.error) {
        setErrorMessage(result.error);
        return;
      }
      setSuccessMessage(
        `Template settings updated. Organization drift is now ${result?.data?.organizationDriftCount ?? 0}.`
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
        `Rolled template changes to ${result?.data?.updatedOffices ?? 0} office${result?.data?.updatedOffices === 1 ? '' : 's'}.`
      );
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Template Updates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and apply template changes safely, without touching live data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VersionBadge version={governanceReport.appliedVersion} label="Current" />
          {!isUpToDate && (
            <>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <VersionBadge version={governanceReport.latestVersion} label="Latest" />
            </>
          )}
        </div>
      </header>

      {/* ── Status Banner ───────────────────────────────────────────── */}
      {lifecycleState !== 'template_confirmed' ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Setup hasn&apos;t been confirmed yet. Finish your business setup first, then come back here for future updates.
        </div>
      ) : isUpToDate ? (
        <div className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <div>
            <span className="font-medium">Everything is up to date.</span>{' '}
            Your {templateSummary.title} template (v{governanceReport.appliedVersion}) is the latest version.
            {existingOfficeCount > 0 && ` ${existingOfficeCount} location${existingOfficeCount !== 1 ? 's' : ''} active.`}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Updates available.</span>{' '}
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} ready to review
            {governanceReport.breakingChangeCount > 0 && (
              <> ({governanceReport.breakingChangeCount} need careful review)</>
            )}.
          </div>
        </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      {/* ── Quick Stats ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Template</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{templateSummary.title}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Locations</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {existingOfficeCount} active
            {governanceReport.officesBehindCount > 0 && (
              <span className="ml-1.5 text-xs font-normal text-amber-600">
                ({governanceReport.officesBehindCount} behind)
              </span>
            )}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Safe changes</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{governanceReport.safeChangeCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Customizations</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{governanceReport.organizationDriftCount}</p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Changelog                                                    */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Changelog</h2>
        </div>

        {governanceReport.migrationReports.length > 0 ? (
          <div className="space-y-2">
            {governanceReport.migrationReports.map((migration) => {
              const key = `${migration.fromVersion}-${migration.toVersion}`;
              const isExpanded = expandedMigrations.has(key);
              return (
                <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMigrations((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">
                          v{migration.fromVersion} → v{migration.toVersion}
                        </span>
                        <span className="text-xs text-muted-foreground">{migration.releasedAt}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{migration.summary}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {migration.safeChanges > 0 && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {migration.safeChanges} safe
                        </span>
                      )}
                      {migration.reviewRequiredChanges > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          {migration.reviewRequiredChanges} review
                        </span>
                      )}
                      {migration.breakingChanges > 0 && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          {migration.breakingChanges} breaking
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-2">
                      {migration.changes.map((change) => (
                        <div
                          key={change.id}
                          className="flex items-start gap-3 rounded-lg bg-background px-3 py-2.5"
                        >
                          <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${impactColor(change.impact)}`}>
                            {change.impact === 'review_required' ? 'review' : change.impact}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{change.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{change.description}</p>
                            {change.recommendedAction && (
                              <p className="mt-1 text-xs text-primary">Tip: {change.recommendedAction}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No pending changes. You&apos;re on the latest version.
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Custom Choices / Section Strategies                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Your customizations</h2>
          </div>
          <Link
            href="/admin/onboarding"
            className="text-sm font-medium text-primary hover:text-primary/70 transition-colors"
          >
            Back to Setup
          </Link>
        </div>

        {hasCustomizations ? (
          <div className="space-y-2">
            {governanceReport.organizationSections
              .filter((section) => section.driftCount > 0)
              .map((section) => (
                <div
                  key={section.key}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          {section.driftCount} change{section.driftCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {section.driftPaths.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Modified: {section.driftPaths.slice(0, 3).join(', ')}
                          {section.driftPaths.length > 3 && ` +${section.driftPaths.length - 3} more`}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1.5">
                      {STRATEGY_OPTIONS.map((option) => {
                        const isSelected = strategies[section.key] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => updateStrategy(section.key, option.value)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}

            <div className="flex items-center justify-end gap-3 pt-2">
              <span className="text-xs text-muted-foreground">
                {selectedDefaultResets} section{selectedDefaultResets !== 1 ? 's' : ''} will reset to defaults
              </span>
              <button
                type="button"
                onClick={handleApplyUpgrade}
                disabled={isUpgradePending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isUpgradePending ? 'animate-spin' : ''}`} />
                {isUpgradePending ? 'Saving...' : 'Apply changes'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No custom overrides detected. All sections match the template defaults.
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Office Rollout                                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {governanceReport.officeReports.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Location rollout</h2>
            </div>
            <button
              type="button"
              onClick={selectAllRolloutCandidates}
              className="text-xs font-medium text-primary hover:text-primary/70 transition-colors"
            >
              Select all
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {governanceReport.officeReports.map((office) => {
              const isSelected = selectedOfficeIds.includes(office.officeId);
              const isCurrent = !office.isUpgradeAvailable && office.driftCount === 0;
              return (
                <label
                  key={office.officeId}
                  className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-primary/[0.03]' : 'hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOfficeSelection(office.officeId)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot status={isCurrent ? 'current' : office.isUpgradeAvailable ? 'behind' : 'drift'} />
                      <span className="text-sm font-medium text-foreground">{office.officeName}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      v{office.appliedVersion}
                      {office.isUpgradeAvailable && ` → v${office.latestVersion}`}
                      {office.driftCount > 0 && ` · ${office.driftCount} custom change${office.driftCount !== 1 ? 's' : ''}`}
                      {office.rolloutCount > 0 && ` · Last rolled out ${formatTimestamp(office.lastRolledOutAt)}`}
                    </p>
                  </div>
                  {office.isUpgradeAvailable ? (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Update available
                    </span>
                  ) : isCurrent ? (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Current
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {selectedOfficeIds.length} of {governanceReport.officeReports.length} selected
            </span>
            <button
              type="button"
              onClick={handleOfficeRollout}
              disabled={isRolloutPending || selectedOfficeIds.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <GitBranch className={`h-3.5 w-3.5 ${isRolloutPending ? 'animate-pulse' : ''}`} />
              {isRolloutPending ? 'Rolling out...' : 'Roll out'}
            </button>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* History                                                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="h-4 w-4" />
          <span className="font-medium">History</span>
          {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {hasHistory && !showHistory && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {governanceReport.migrationHistory.length + governanceReport.officeRolloutHistory.length} events
            </span>
          )}
        </button>

        {showHistory && (
          <div className="space-y-2">
            {hasHistory ? (
              <>
                {governanceReport.migrationHistory.slice(0, 5).map((entry) => (
                  <div
                    key={`${entry.appliedAt}-${entry.fromVersion}-${entry.toVersion}`}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <Settings className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Updated v{entry.fromVersion} → v{entry.toVersion}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatTimestamp(entry.appliedAt)} · {summarizeSectionStrategies(entry.sectionStrategies as Record<string, string>)}
                      </p>
                    </div>
                  </div>
                ))}
                {governanceReport.officeRolloutHistory.slice(0, 8).map((entry) => (
                  <div
                    key={`${entry.officeId}-${entry.rolledOutAt}-${entry.toVersion}`}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {entry.officeName} → v{entry.toVersion}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatTimestamp(entry.rolledOutAt)} · from v{entry.fromVersion}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No update history recorded yet.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
