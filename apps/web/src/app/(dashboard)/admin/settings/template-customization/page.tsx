import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { getServerI18n } from '@/lib/i18n';
import { TemplateCustomizationClient } from './template-customization-client';

export default async function TemplateCustomizationPage() {
  const { t } = await getServerI18n();
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const { data: organization, error: orgError } = await context.supabase
    .from('organizations')
    .select('*')
    .eq('id', context.staff.organization_id)
    .single();

  if (orgError || !organization) {
    return (
      <div className="p-6 text-red-500">
        {t('Failed to load organization settings.')}
      </div>
    );
  }

  const settings = (organization.settings ?? {}) as Record<string, unknown>;
  const platformConfig = resolvePlatformConfig({ organizationSettings: settings });

  const templateId = typeof settings.platform_template_id === 'string'
    ? settings.platform_template_id
    : platformConfig.template.id;

  const profileId = typeof settings.platform_profile_id === 'string'
    ? settings.platform_profile_id
    : typeof settings.platform_trial_profile_id === 'string'
      ? settings.platform_trial_profile_id
      : undefined;

  const overrides = settings.platform_overrides && typeof settings.platform_overrides === 'object'
    ? settings.platform_overrides as Record<string, unknown>
    : {};

  return (
    <TemplateCustomizationClient
      organizationId={organization.id}
      templateId={templateId}
      profileId={profileId}
      currentOverrides={overrides}
      template={platformConfig.template}
    />
  );
}
