// TODO: Lawyer review required before relying on any compliance claims made on this page.

import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { getServerI18n } from '@/lib/i18n';
import { PrivacySettingsClient } from './privacy-settings-client';

export default async function PrivacySettingsPage() {
  const { t } = await getServerI18n();
  const context = await getStaffContext();

  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/settings');
  }

  const { data: organization, error: orgError } = await context.supabase
    .from('organizations')
    .select('id, country, settings')
    .eq('id', context.staff.organization_id)
    .single();

  if (orgError || !organization) {
    return (
      <div className="p-6 text-destructive">
        {t('Failed to load organization settings.')}
      </div>
    );
  }

  const settings = (organization.settings ?? {}) as Record<string, unknown>;
  const dpoEmail = typeof settings.dpo_contact_email === 'string'
    ? settings.dpo_contact_email
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Privacy &amp; Compliance</h1>
        <p className="text-sm text-muted-foreground">
          Manage your data protection settings, DPO contact, and compliance documents.
        </p>
      </div>
      <PrivacySettingsClient
        orgId={organization.id}
        orgCountry={organization.country ?? null}
        dpoEmail={dpoEmail}
      />
    </div>
  );
}
