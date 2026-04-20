import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { StaffClient } from './staff-client';
import { PageTabs } from '@/components/layout/page-tabs';
import { STRUCTURE_TABS } from '@/components/layout/admin-nav-groups';

export default async function StaffPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/desk');
  }

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', context.staff.organization_id)
    .single();

  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization?.settings ?? {},
  });

  const { data: offices } = await context.supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', context.staff.organization_id)
    .eq('is_active', true)
    .order('name');

  const { data: departments } = await context.supabase
    .from('departments')
    .select('id, name, office:offices(id, name)')
    .order('name');

  const { data: staff, error } = await context.supabase
    .from('staff')
    .select('*, office:offices(id, name), department:departments(id, name)')
    .eq('organization_id', context.staff.organization_id)
    .order('full_name');

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load staff: {error.message}</p>
      </div>
    );
  }

  const normalizedDepartments = (departments ?? []).map((department) => ({
    ...department,
    office: Array.isArray(department.office) ? department.office[0] ?? null : department.office,
  }));

  return (
    <>
      <PageTabs tabs={STRUCTURE_TABS} />
      <StaffClient
        staff={staff ?? []}
        offices={offices ?? []}
        departments={normalizedDepartments}
        roleDefinitions={platformConfig.rolePolicy.roles}
      />
    </>
  );
}
