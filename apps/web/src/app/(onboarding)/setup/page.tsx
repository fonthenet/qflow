import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SetupWizard } from './setup-wizard';

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, organization:organizations(*)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  const org = staff.organization as unknown as Record<string, unknown>;

  // If onboarding is already completed, go to dashboard
  if (org.onboarding_completed) {
    redirect('/admin/offices');
  }

  return (
    <SetupWizard
      orgId={org.id as string}
      orgName={org.name as string}
      initialStep={(org.onboarding_step as number) || 0}
      savedBusinessType={(org.business_type as string) || ''}
      savedBusinessSubtype={(org.business_subtype as string) || ''}
    />
  );
}
