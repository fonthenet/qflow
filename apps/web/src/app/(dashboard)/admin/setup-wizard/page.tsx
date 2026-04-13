import { redirect } from 'next/navigation';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { getPlatformLifecycleState, resolvePlatformConfig } from '@/lib/platform/config';
import { SetupWizardClient } from './setup-wizard-client';

export default async function SetupWizardPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/offices');
  }

  const orgId = context.staff.organization_id;

  // Fetch organization
  const { data: organization } = await context.supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', orgId)
    .single();

  if (!organization) redirect('/admin/offices');

  const settings = (organization.settings as Record<string, any>) ?? {};
  const lifecycleState = getPlatformLifecycleState(settings, { hasExistingData: true });

  // Only show wizard if template is confirmed but wizard not yet completed
  if (lifecycleState !== 'template_confirmed') {
    redirect('/admin/onboarding');
  }

  if (settings.business_setup_wizard_completed_at) {
    redirect('/admin/overview');
  }

  const platformConfig = resolvePlatformConfig({
    organizationSettings: settings,
  });
  const vocabulary = platformConfig.experienceProfile.vocabulary;

  // Fetch all data needed for the wizard
  const [
    { data: offices },
    { data: departments },
    { data: services },
    { data: desks },
    { data: staffList },
    { data: deskServices },
  ] = await Promise.all([
    context.supabase
      .from('offices')
      .select('id, name, address, phone, settings, is_active')
      .eq('organization_id', orgId)
      .order('name'),
    context.supabase
      .from('departments')
      .select('id, name, code, description, office_id, is_active, office:offices(id, name)')
      .eq('is_active', true)
      .order('sort_order'),
    context.supabase
      .from('services')
      .select('id, name, code, description, estimated_service_time, department_id, is_active, department:departments(id, name, office_id)')
      .eq('is_active', true)
      .order('name'),
    context.supabase
      .from('desks')
      .select('id, name, display_name, office_id, department_id, current_staff_id, status, is_active, department:departments(id, name), office:offices(id, name), current_staff:staff(id, full_name)')
      .eq('is_active', true)
      .order('name'),
    context.supabase
      .from('staff')
      .select('id, full_name, email, role, office_id, department_id, is_active, office:offices(id, name), department:departments(id, name)')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('full_name'),
    context.supabase
      .from('desk_services')
      .select('desk_id, service_id'),
  ]);

  // Filter departments/services to only those belonging to this org's offices
  const orgOfficeIds = new Set((offices ?? []).map((o: any) => o.id));
  const orgDepartments = (departments ?? []).filter((d: any) => orgOfficeIds.has(d.office_id));
  const orgDeptIds = new Set(orgDepartments.map((d: any) => d.id));
  const orgServices = (services ?? []).filter((s: any) => orgDeptIds.has(s.department_id));

  return (
    <SetupWizardClient
      organization={{ id: organization.id, name: organization.name }}
      vocabulary={vocabulary ? { serviceLabel: vocabulary.serviceLabel, departmentLabel: vocabulary.departmentLabel, deskLabel: vocabulary.deskLabel, officeLabel: vocabulary.officeLabel } : undefined}
      offices={(offices ?? []) as any}
      departments={orgDepartments as any}
      services={orgServices as any}
      desks={(desks ?? []).filter((d: any) => orgOfficeIds.has(d.office_id)) as any}
      staffList={(staffList ?? []) as any}
      deskServices={(deskServices ?? []) as any}
    />
  );
}
