import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import {
  getPlatformLifecycleState,
  resolvePlatformConfig,
  summarizeTemplate,
} from '@/lib/platform/config';
import { TemplateOnboardingClient } from './template-onboarding-client';

export default async function PlatformOnboardingPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const [{ data: organization }, { count: officeCount }] = await Promise.all([
    context.supabase.from('organizations').select('*').eq('id', context.staff.organization_id).single(),
    context.supabase
      .from('offices')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', context.staff.organization_id),
  ]);

  if (!organization) {
    return <div className="p-6 text-red-500">Unable to load organization settings.</div>;
  }

  const lifecycleState = getPlatformLifecycleState(organization.settings ?? {}, {
    hasExistingData: (officeCount ?? 0) > 0,
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
      existingOfficeCount={officeCount ?? 0}
      lifecycleState={lifecycleState}
      currentTemplate={summarizeTemplate(liveConfig)}
      trialTemplate={summarizeTemplate(trialConfig)}
      trialSettings={(organization.settings ?? {}) as Record<string, unknown>}
    />
  );
}
