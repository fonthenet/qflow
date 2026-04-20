import { redirect } from 'next/navigation';
import { getStaffContext } from '@/lib/authz';
import { DisplaysManager } from '@/components/admin/display-settings';
import { PageTabs } from '@/components/layout/page-tabs';
import { PUBLIC_SCREEN_TABS } from '@/components/layout/admin-nav-groups';

export default async function DisplaysAdminPage() {
  const context = await getStaffContext();

  if (context.accessibleOfficeIds.length === 0) redirect('/desk');

  const { data: offices } = await context.supabase
    .from('offices')
    .select('id, name, is_active')
    .in('id', context.accessibleOfficeIds)
    .order('name');

  const officeIds = (offices ?? []).map((o) => o.id);
  const { data: screens } = officeIds.length > 0
    ? await context.supabase
        .from('display_screens')
        .select('*')
        .in('office_id', officeIds)
        .order('name')
    : { data: [] };

  const { data: departments } = officeIds.length > 0
    ? await context.supabase
        .from('departments')
        .select('id, name, code, office_id, is_active')
        .in('office_id', officeIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] };

  return (
    <>
      <PageTabs tabs={PUBLIC_SCREEN_TABS} />
      <DisplaysManager
        screens={screens ?? []}
        offices={offices ?? []}
        departments={departments ?? []}
      />
    </>
  );
}
