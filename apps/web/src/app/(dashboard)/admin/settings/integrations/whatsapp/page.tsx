import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { loadWhatsAppCredentials } from '@/lib/actions/whatsapp-actions';
import { WhatsAppSettingsClient } from './whatsapp-settings-client';
import { WhatsAppEmbeddedSignupButton } from './embedded-signup-button';

export default async function WhatsAppSettingsPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/settings');
  }

  const credentials = await loadWhatsAppCredentials();

  if ('error' in credentials) {
    return (
      <div className="p-6 text-destructive">
        {credentials.error}
      </div>
    );
  }

  const webhookBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://qflo.app';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">WhatsApp Integration</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Meta WhatsApp Business Account so Qflo can send queue
          notifications and accept inbound messages on your behalf.
        </p>
      </div>
      <WhatsAppEmbeddedSignupButton />
      <WhatsAppSettingsClient
        initialPhoneNumberId={credentials.phone_number_id ?? ''}
        initialBusinessAccountId={credentials.business_account_id ?? ''}
        initialVerifyToken={credentials.verify_token ?? ''}
        hasToken={credentials.has_token}
        webhookBase={webhookBase}
      />
    </div>
  );
}
