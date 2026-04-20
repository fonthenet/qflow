import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { KioskSettings } from '@/components/admin/kiosk-settings';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { PageTabs } from '@/components/layout/page-tabs';
import { PUBLIC_SCREEN_TABS } from '@/components/layout/admin-nav-groups';

export default async function KioskAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  // Fetch organization with settings
  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', staff.organization_id)
    .single();

  if (!organization) redirect('/login');
  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization.settings ?? {},
  });

  // Fetch offices for preview links
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, is_active, settings')
    .eq('organization_id', staff.organization_id)
    .order('name');

  // Fetch departments with services for visibility controls
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, code, office_id, is_active, sort_order, services(id, name, code, is_active, sort_order)')
    .in(
      'office_id',
      (offices ?? []).map((o) => o.id)
    )
    .order('sort_order');

  return (
    <>
      <PageTabs tabs={PUBLIC_SCREEN_TABS} />
      <KioskSettings
        organization={organization}
        offices={offices ?? []}
        departments={departments ?? []}
        templateDefaults={platformConfig.experienceProfile.kiosk}
        priorityMode={platformConfig.queuePolicy.priorityMode}
      />
    </>
  );
}
