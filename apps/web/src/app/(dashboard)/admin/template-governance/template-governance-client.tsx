'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TemplateLifecycleState } from '@queueflow/shared';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  MapPin,
  RefreshCw,
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
    label: 'Keep mine',
    description: 'Preserve your customizations.',
  },
  {
    value: 'adopt_defaults',
    label: 'Use template',
    description: 'Reset to the latest defaults.',
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

/* ── Reusable pieces ────────────────────────────────────────────────── */

function VersionBadge({ version, label }: { version: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
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

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${color ?? 'text-foreground'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function HealthBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-bold text-foreground">{percent}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            percent >= 80 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────── */

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
  const [activeTab, setActiveTab] = useState<'overview' | 'changelog' | 'rollout'>('overview');

  const selectedDefaultResets = useMemo(
    () => Object.values(strategies).filter((v) => v === 'adopt_defaults').length,
    [strategies]
  );

  const isUpToDate = !governanceReport.isUpgradeAvailable;
  const hasCustomizations = governanceReport.organizationSections.some((s) => s.driftCount > 0);
  const hasHistory = governanceReport.migrationHistory.length > 0 || governanceReport.officeRolloutHistory.length > 0;
  const totalChanges = governanceReport.safeChangeCount + governanceReport.reviewRequiredChangeCount + governanceReport.breakingChangeCount;
  const health = governanceReport.healthSummary;

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

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'changelog' as const, label: 'Changelog', count: totalChanges },
    { id: 'rollout' as const, label: 'Locations', count: governanceReport.officeReports.length },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Template Updates</h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
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
      </div>

      {/* ── Status Banner ───────────────────────────────────────────── */}
      {lifecycleState !== 'template_confirmed' ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
          <Clock className="h-4 w-4 shrink-0" />
          Setup hasn&apos;t been confirmed yet.{' '}
          <Link href="/admin/onboarding" className="font-medium underline underline-offset-2 hover:text-amber-800">
            Finish your business setup
          </Link>{' '}
          first, then come back here for future updates.
        </div>
      ) : isUpToDate ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">Everything is up to date.</span>{' '}
            Your {templateSummary.title} template (v{governanceReport.appliedVersion}) is the latest version.
            {existingOfficeCount > 0 && ` ${existingOfficeCount} location${existingOfficeCount !== 1 ? 's' : ''} active.`}
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-700">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Updates available.</span>{' '}
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} ready to review
            {governanceReport.breakingChangeCount > 0 && (
              <> ({governanceReport.breakingChangeCount} need careful review)</>
            )}.
          </div>
        </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="mb-6 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center gap-1 rounded-xl bg-muted/40 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                activeTab === tab.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* OVERVIEW TAB                                                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Health Dashboard */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <StatCard label="Template" value={templateSummary.title} sub={`v${governanceReport.appliedVersion}`} />
            <StatCard
              label="Locations"
              value={existingOfficeCount}
              sub={governanceReport.officesBehindCount > 0 ? `${governanceReport.officesBehindCount} behind` : 'All current'}
              color={governanceReport.officesBehindCount > 0 ? 'text-amber-600' : 'text-foreground'}
            />
            <StatCard
              label="Safe Changes"
              value={governanceReport.safeChangeCount}
              sub="Auto-applicable"
              color={governanceReport.safeChangeCount > 0 ? 'text-emerald-600' : 'text-foreground'}
            />
            <StatCard
              label="Customizations"
              value={governanceReport.organizationDriftCount}
              sub={hasCustomizations ? 'Custom overrides' : 'Matching defaults'}
              color={governanceReport.organizationDriftCount > 0 ? 'text-amber-600' : 'text-foreground'}
            />
          </div>

          {/* Health Bars */}
          {health.officeCount > 0 && (
            <SectionCard>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Template Health</h3>
                </div>
                <HealthBar percent={health.currentVersionCoveragePercent} label="Version coverage" />
                <HealthBar percent={health.branchAlignmentPercent} label="Configuration alignment" />
                <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <span>Last migration: {formatTimestamp(health.lastMigrationAt)}</span>
                  <span>Last rollout: {formatTimestamp(health.lastOfficeRolloutAt)}</span>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Customizations section */}
          <SectionCard>
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Your customizations</h3>
              </div>
              <Link
                href="/admin/onboarding"
                className="text-xs font-medium text-primary hover:text-primary/70 transition-colors"
              >
                Back to Setup
              </Link>
            </div>

            <div className="px-6 pb-6">
              {hasCustomizations ? (
                <div className="space-y-3 mt-3">
                  {governanceReport.organizationSections
                    .filter((section) => section.driftCount > 0)
                    .map((section) => (
                      <div
                        key={section.key}
                        className="rounded-xl border border-border/60 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-foreground">{section.label}</h4>
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
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
                                  title={option.description}
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                    isSelected
                                      ? 'border-primary bg-primary/5 text-primary shadow-sm'
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
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isUpgradePending ? 'animate-spin' : ''}`} />
                      {isUpgradePending ? 'Saving...' : 'Apply changes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No custom overrides detected. All sections match the template defaults.
                </div>
              )}
            </div>
          </SectionCard>

          {/* Template info summary */}
          <SectionCard>
            <div className="p-6">
              <h3 className="text-sm font-semibold text-foreground mb-3">Active Template</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted/30 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Type</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.vertical.replace(/_/g, ' ')}</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mode</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.operatingModel.replace(/_/g, ' ')}</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Branch</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.branchType.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Enabled Modules</p>
                <div className="flex flex-wrap gap-1.5">
                  {templateSummary.enabledModules.map((module) => (
                    <span
                      key={module}
                      className="rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {module.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* CHANGELOG TAB                                                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'changelog' && (
        <div className="space-y-4">
          {governanceReport.migrationReports.length > 0 ? (
            governanceReport.migrationReports.map((migration) => {
              const key = `${migration.fromVersion}-${migration.toVersion}`;
              const isExpanded = expandedMigrations.has(key);
              return (
                <SectionCard key={key} className="overflow-hidden">
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
                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/20 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">
                          v{migration.fromVersion} &rarr; v{migration.toVersion}
                        </span>
                        <span className="text-xs text-muted-foreground">{migration.releasedAt}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{migration.summary}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {migration.safeChanges > 0 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          {migration.safeChanges} safe
                        </span>
                      )}
                      {migration.reviewRequiredChanges > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          {migration.reviewRequiredChanges} review
                        </span>
                      )}
                      {migration.breakingChanges > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          {migration.breakingChanges} breaking
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/50 bg-muted/10 px-5 py-4 space-y-2.5">
                      {migration.changes.map((change) => (
                        <div
                          key={change.id}
                          className="flex items-start gap-3 rounded-xl bg-background px-4 py-3 border border-border/30"
                        >
                          <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${impactColor(change.impact)}`}>
                            {change.impact === 'review_required' ? 'review' : change.impact}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{change.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{change.description}</p>
                            {change.recommendedAction && (
                              <p className="mt-1.5 text-xs text-primary font-medium">Tip: {change.recommendedAction}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center">
              <Zap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No pending changes</p>
              <p className="mt-1 text-xs text-muted-foreground">You&apos;re on the latest version.</p>
            </div>
          )}

          {/* History */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Clock className="h-4 w-4" />
              <span className="font-medium">Update history</span>
              {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {hasHistory && !showHistory && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">
                  {governanceReport.migrationHistory.length + governanceReport.officeRolloutHistory.length}
                </span>
              )}
            </button>

            {showHistory && (
              <div className="mt-3 space-y-2">
                {hasHistory ? (
                  <>
                    {governanceReport.migrationHistory.slice(0, 5).map((entry) => (
                      <div
                        key={`${entry.appliedAt}-${entry.fromVersion}-${entry.toVersion}`}
                        className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                      >
                        <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            Updated v{entry.fromVersion} &rarr; v{entry.toVersion}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatTimestamp(entry.appliedAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {governanceReport.officeRolloutHistory.slice(0, 8).map((entry) => (
                      <div
                        key={`${entry.officeId}-${entry.rolledOutAt}-${entry.toVersion}`}
                        className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3"
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {entry.officeName} &rarr; v{entry.toVersion}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatTimestamp(entry.rolledOutAt)} &middot; from v{entry.fromVersion}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    No update history recorded yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ROLLOUT TAB                                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'rollout' && (
        <div className="space-y-4">
          {governanceReport.officeReports.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select locations to push the latest template version to.
                </p>
                <button
                  type="button"
                  onClick={selectAllRolloutCandidates}
                  className="text-xs font-medium text-primary hover:text-primary/70 transition-colors"
                >
                  Select all
                </button>
              </div>

              <SectionCard className="overflow-hidden divide-y divide-border/50">
                {governanceReport.officeReports.map((office) => {
                  const isSelected = selectedOfficeIds.includes(office.officeId);
                  const isCurrent = !office.isUpgradeAvailable && office.driftCount === 0;
                  return (
                    <label
                      key={office.officeId}
                      className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/[0.03]' : 'hover:bg-muted/20'
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
                          {office.isUpgradeAvailable && ` \u2192 v${office.latestVersion}`}
                          {office.driftCount > 0 && ` \u00B7 ${office.driftCount} custom change${office.driftCount !== 1 ? 's' : ''}`}
                          {office.rolloutCount > 0 && ` \u00B7 Last rolled out ${formatTimestamp(office.lastRolledOutAt)}`}
                        </p>
                      </div>
                      {office.isUpgradeAvailable ? (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                          Update available
                        </span>
                      ) : isCurrent ? (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                          Current
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </SectionCard>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">
                  {selectedOfficeIds.length} of {governanceReport.officeReports.length} selected
                </span>
                <button
                  type="button"
                  onClick={handleOfficeRollout}
                  disabled={isRolloutPending || selectedOfficeIds.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <GitBranch className={`h-3.5 w-3.5 ${isRolloutPending ? 'animate-pulse' : ''}`} />
                  {isRolloutPending ? 'Rolling out...' : 'Roll out'}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center">
              <MapPin className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No locations yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Once you create offices, they&apos;ll appear here for template rollout.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
