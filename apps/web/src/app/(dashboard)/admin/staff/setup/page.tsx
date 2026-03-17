import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { StaffSetupWizard } from './staff-setup-wizard';

export default async function StaffSetupPage() {
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
    .order('name');

  const { data: departments } = await context.supabase
    .from('departments')
    .select('id, name, office_id, office:offices(id, name)')
    .order('name');

  const { data: desks } = await context.supabase
    .from('desks')
    .select('id, name, display_name, office_id, department_id, is_active, current_staff_id')
    .eq('is_active', true)
    .order('name');

  const normalizedDepartments = (departments ?? []).map((d) => ({
    ...d,
    office: Array.isArray(d.office) ? d.office[0] ?? null : d.office,
  }));

  const vocabulary = platformConfig.experienceProfile.vocabulary;

  return (
    <StaffSetupWizard
      offices={offices ?? []}
      departments={normalizedDepartments}
      desks={desks ?? []}
      roleDefinitions={platformConfig.rolePolicy.roles}
      vocabulary={{
        deskLabel: vocabulary?.deskLabel ?? 'Desk',
        departmentLabel: vocabulary?.departmentLabel ?? 'Department',
        officeLabel: vocabulary?.officeLabel ?? 'Location',
        serviceLabel: vocabulary?.serviceLabel ?? 'Service',
        customerLabel: vocabulary?.customerLabel ?? 'Customer',
        queueLabel: vocabulary?.queueLabel ?? 'Queue',
      }}
    />
  );
}
