import type { StaffContext } from '@/lib/authz';
import { buildTemplateGovernanceReport, type TemplateGovernanceReport } from './governance';

type OfficeSnapshotRow = {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
};

export type TemplateSnapshotScope = 'organization' | 'office';
export type TemplateSnapshotType = 'template_applied' | 'template_upgraded' | 'office_rollout';

interface SnapshotInsertRow {
  organization_id: string;
  office_id: string | null;
  actor_staff_id: string | null;
  snapshot_scope: TemplateSnapshotScope;
  snapshot_type: TemplateSnapshotType;
  template_id: string;
  applied_version: string;
  latest_version: string;
  organization_drift_count: number;
  office_drift_count: number;
  office_count: number;
  offices_current_count: number;
  offices_behind_count: number;
  offices_with_drift: number;
  current_version_coverage_percent: number;
  branch_alignment_percent: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

function buildOrganizationSnapshotRow(input: {
  report: TemplateGovernanceReport;
  context: StaffContext;
  snapshotType: TemplateSnapshotType;
  createdAt: string;
}): SnapshotInsertRow {
  const { report, context, snapshotType, createdAt } = input;

  return {
    organization_id: context.staff.organization_id,
    office_id: null,
    actor_staff_id: context.staff.id,
    snapshot_scope: 'organization',
    snapshot_type: snapshotType,
    template_id: report.templateId,
    applied_version: report.appliedVersion,
    latest_version: report.latestVersion,
    organization_drift_count: report.organizationDriftCount,
    office_drift_count: report.officeDriftCount,
    office_count: report.healthSummary.officeCount,
    offices_current_count: report.healthSummary.officesCurrentCount,
    offices_behind_count: report.healthSummary.officesBehindCount,
    offices_with_drift: report.healthSummary.officesWithDrift,
    current_version_coverage_percent: report.healthSummary.currentVersionCoveragePercent,
    branch_alignment_percent: report.healthSummary.branchAlignmentPercent,
    metadata: {
      safeChangeCount: report.safeChangeCount,
      reviewRequiredChangeCount: report.reviewRequiredChangeCount,
      breakingChangeCount: report.breakingChangeCount,
      migrationCount: report.migrationReports.length,
    },
    created_at: createdAt,
  };
}

function buildOfficeSnapshotRows(input: {
  report: TemplateGovernanceReport;
  context: StaffContext;
  snapshotType: TemplateSnapshotType;
  createdAt: string;
  officeIds?: string[];
}): SnapshotInsertRow[] {
  const officeFilter = input.officeIds ? new Set(input.officeIds) : null;

  return input.report.officeReports
    .filter((office) => !officeFilter || officeFilter.has(office.officeId))
    .map((office) => ({
      organization_id: input.context.staff.organization_id,
      office_id: office.officeId,
      actor_staff_id: input.context.staff.id,
      snapshot_scope: 'office' as const,
      snapshot_type: input.snapshotType,
      template_id: input.report.templateId,
      applied_version: office.appliedVersion,
      latest_version: office.latestVersion,
      organization_drift_count: input.report.organizationDriftCount,
      office_drift_count: office.driftCount,
      office_count: 1,
      offices_current_count: office.isUpgradeAvailable ? 0 : 1,
      offices_behind_count: office.isUpgradeAvailable ? 1 : 0,
      offices_with_drift: office.driftCount > 0 ? 1 : 0,
      current_version_coverage_percent: office.isUpgradeAvailable ? 0 : 100,
      branch_alignment_percent: office.driftCount > 0 ? 0 : 100,
      metadata: {
        rolloutCount: office.rolloutCount,
        lastRolledOutAt: office.lastRolledOutAt,
      },
      created_at: input.createdAt,
    }));
}

export function buildTemplateHealthSnapshotRows(input: {
  report: TemplateGovernanceReport;
  context: StaffContext;
  snapshotType: TemplateSnapshotType;
  officeIds?: string[];
}) {
  const createdAt = new Date().toISOString();

  return [
    buildOrganizationSnapshotRow({
      report: input.report,
      context: input.context,
      snapshotType: input.snapshotType,
      createdAt,
    }),
    ...buildOfficeSnapshotRows({
      report: input.report,
      context: input.context,
      snapshotType: input.snapshotType,
      createdAt,
      officeIds: input.officeIds,
    }),
  ];
}

export async function recordTemplateHealthSnapshots(input: {
  context: StaffContext;
  organizationSettings: unknown;
  offices: OfficeSnapshotRow[];
  snapshotType: TemplateSnapshotType;
  officeIds?: string[];
}) {
  const report = buildTemplateGovernanceReport({
    organizationSettings: input.organizationSettings,
    offices: input.offices,
  });
  const rows = buildTemplateHealthSnapshotRows({
    report,
    context: input.context,
    snapshotType: input.snapshotType,
    officeIds: input.officeIds,
  });

  const { error } = await input.context.supabase.from('template_health_snapshots').insert(rows);

  if (error) {
    console.error('[TemplateSnapshots] Failed to record template health snapshots:', error.message);
  }

  return report;
}
