import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { SettingsClient } from './settings-client';
import { isSmsProviderConfigured } from '@/lib/sms';
import { isWhatsAppConfigured } from '@/lib/whatsapp';
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

  // Fetch virtual queue codes for the WhatsApp settings dropdown
  const orgId = context.staff.organization_id;
  const { data: offices } = await context.supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', orgId);
  const officeIds = (offices ?? []).map((o: any) => o.id);
  const officeMap = Object.fromEntries((offices ?? []).map((o: any) => [o.id, o.name]));

  let virtualQueueCodes: { id: string; label: string }[] = [];
  if (officeIds.length > 0) {
    const { data: codes } = await context.supabase
      .from('virtual_queue_codes')
      .select('id, office_id, department_id, service_id, is_active, departments(name), services(name)')
      .in('office_id', officeIds)
      .eq('is_active', true);
    virtualQueueCodes = (codes ?? []).map((c: any) => ({
      id: c.id,
      label: [
        officeMap[c.office_id] ?? '',
        c.departments?.name ?? '',
        c.services?.name ?? '',
      ].filter(Boolean).join(' → '),
    }));
  }

  // Check Messenger connection status
  // The /me endpoint requires pages_read_engagement which we may not have,
  // so we verify the token by checking the messenger_profile endpoint instead.
  let messengerPageInfo: { connected: boolean; page?: { id: string; name: string; pictureUrl: string | null }; reason?: string } = { connected: false };
  const pageToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN?.trim();
  if (pageToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v22.0/me/messenger_profile?fields=get_started&access_token=${pageToken}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (res.ok && !data.error) {
        // Token is valid — messenger is connected
        const orgSettings = (organization.settings ?? {}) as Record<string, any>;
        messengerPageInfo = {
          connected: true,
          page: {
            id: orgSettings.messenger_page_id ?? '',
            name: 'Facebook Page',
            pictureUrl: null,
          },
        };
      } else {
        messengerPageInfo = { connected: false, reason: data.error?.message ?? 'Invalid token' };
      }
    } catch {
      messengerPageInfo = { connected: false, reason: 'Network error' };
    }
  }

  return (
    <div className="space-y-6">
      <SettingsClient
        organization={organization}
        smsProviderReady={isSmsProviderConfigured()}
        whatsappProviderReady={isWhatsAppConfigured()}
        templateSummary={summarizeTemplate(platformConfig)}
        templateConfigured={typeof (organization.settings as Record<string, unknown> | null)?.platform_template_id === 'string'}
        wizardCompleted={typeof (organization.settings as Record<string, unknown> | null)?.business_setup_wizard_completed_at === 'string'}
        messengerPageInfo={messengerPageInfo}
        virtualQueueCodes={virtualQueueCodes}
      />
    </div>
  );
}
