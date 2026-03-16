import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import {
  getPlatformLifecycleState,
  resolvePlatformConfig,
  summarizeTemplate,
} from '@/lib/platform/config';
import { buildTemplateGovernanceReport } from '@/lib/platform/governance';
import { TemplateGovernanceClient } from './template-governance-client';

export default async function TemplateGovernancePage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const [{ data: organization, error: organizationError }, { data: offices, error: officesError }] =
    await Promise.all([
      context.supabase
        .from('organizations')
        .select('id, name, settings')
        .eq('id', context.staff.organization_id)
        .single(),
      context.supabase
        .from('offices')
        .select('id, name, settings')
        .eq('organization_id', context.staff.organization_id)
        .order('name'),
    ]);

  if (organizationError || !organization) {
    return (
      <div className="p-6">
        <p className="text-destructive">
          Failed to load template governance: {organizationError?.message ?? 'Unknown error'}
        </p>
      </div>
    );
  }

  if (officesError) {
    return (
      <div className="p-6">
        <p className="text-destructive">
          Failed to load office drift data: {officesError.message}
        </p>
      </div>
    );
  }

  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
  });
  const lifecycleState = getPlatformLifecycleState(organization.settings ?? {}, {
    hasExistingData: (offices ?? []).length > 0,
  });
  const governanceReport = buildTemplateGovernanceReport({
    organizationSettings: organization.settings ?? {},
    offices: offices ?? [],
  });

  return (
    <TemplateGovernanceClient
      organization={{
        id: organization.id,
        name: organization.name,
      }}
      lifecycleState={lifecycleState}
      existingOfficeCount={(offices ?? []).length}
      templateSummary={summarizeTemplate(platformConfig)}
      governanceReport={governanceReport}
    />
  );
}
