import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { SettingsClient } from './settings-client';
import { isSmsProviderConfigured } from '@/lib/sms';
import { resolvePlatformConfig, summarizeTemplate } from '@/lib/platform/config';
import { getServerI18n } from '@/lib/i18n';

export default async function SettingsPage() {
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
  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
  });

  return (
    <SettingsClient
      organization={organization}
      smsProviderReady={isSmsProviderConfigured()}
      templateSummary={summarizeTemplate(platformConfig)}
      templateConfigured={typeof (organization.settings as Record<string, unknown> | null)?.platform_template_id === 'string'}
    />
  );
}
