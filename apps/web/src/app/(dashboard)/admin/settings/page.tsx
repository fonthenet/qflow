import { createClient } from '@/lib/supabase/server';
import { SettingsClient } from './settings-client';
import { isSmsProviderConfigured } from '@/lib/sms';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="p-6 text-red-500">Not authenticated.</div>
    );
  }

  // Get the staff member's organization
  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (staffError || !staff) {
    return (
      <div className="p-6 text-red-500">
        Failed to load organization settings.
      </div>
    );
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', staff.organization_id)
    .single();

  if (orgError || !organization) {
    return (
      <div className="p-6 text-red-500">
        Failed to load organization settings.
      </div>
    );
  }

  return (
    <SettingsClient
      organization={organization}
      smsProviderReady={isSmsProviderConfigured()}
    />
  );
}
