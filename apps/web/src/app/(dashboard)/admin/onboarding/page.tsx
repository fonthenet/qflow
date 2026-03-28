import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import {
  getPlatformLifecycleState,
  resolvePlatformConfig,
  summarizeTemplate,
} from '@/lib/platform/config';
import { TemplateOnboardingClient } from './template-onboarding-client';
import { getServerI18n } from '@/lib/i18n';

export default async function PlatformOnboardingPage() {
  const { t } = await getServerI18n();
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const orgId = context.staff.organization_id;
  const [{ data: organization }, { data: offices }] = await Promise.all([
    context.supabase.from('organizations').select('*').eq('id', orgId).single(),
    context.supabase.from('offices').select('id').eq('organization_id', orgId),
  ]);

  if (!organization) {
    return <div className="p-6 text-red-500">{t('Unable to load organization settings.')}</div>;
  }

  const officeIds = (offices ?? []).map((o: any) => o.id);
  const officeCount = officeIds.length;

  // Fetch live counts for the summary panel
  let liveCounts: { departments: number; services: number; desks: number; displays: number } | undefined;
  if (officeCount > 0) {
    const [{ data: depts }, { count: deskCount }, { count: displayCount }] = await Promise.all([
      context.supabase
        .from('departments')
        .select('id')
        .eq('is_active', true)
        .in('office_id', officeIds),
      context.supabase
        .from('desks')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('office_id', officeIds),
      context.supabase
        .from('display_screens')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('office_id', officeIds),
    ]);
    const deptIds = (depts ?? []).map((d: any) => d.id);
    let serviceCount = 0;
    if (deptIds.length > 0) {
      const { count } = await context.supabase
        .from('services')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('department_id', deptIds);
      serviceCount = count ?? 0;
    }
    liveCounts = {
      departments: deptIds.length,
      services: serviceCount,
      desks: deskCount ?? 0,
      displays: displayCount ?? 0,
    };
  }

  const lifecycleState = getPlatformLifecycleState(organization.settings ?? {}, {
    hasExistingData: officeCount > 0,
  });
  const liveConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
  });
  const trialConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
    mode: 'trial',
  });

  return (
    <TemplateOnboardingClient
      organization={{
        id: organization.id,
        name: organization.name,
      }}
      existingOfficeCount={officeCount}
      lifecycleState={lifecycleState}
      currentTemplate={summarizeTemplate(liveConfig)}
      trialTemplate={summarizeTemplate(trialConfig)}
      trialSettings={(organization.settings ?? {}) as Record<string, unknown>}
      liveCounts={liveCounts}
    />
  );
}
