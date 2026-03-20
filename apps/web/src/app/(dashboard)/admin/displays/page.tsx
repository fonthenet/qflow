import { redirect } from 'next/navigation';
import { getStaffContext } from '@/lib/authz';
import { DisplaysManager } from '@/components/admin/display-settings';

export default async function DisplaysAdminPage() {
  const context = await getStaffContext();

  if (context.accessibleOfficeIds.length === 0) redirect('/desk');

  // Fetch organization for live preview (logo, name)
  const { data: organization } = await context.supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', context.staff.organization_id)
    .single();

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
    <DisplaysManager
      screens={screens ?? []}
      offices={offices ?? []}
      departments={departments ?? []}
      organization={organization ?? undefined}
    />
  );
}
