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

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', orgId)
    .single();

  if (!organization) redirect('/admin/offices');

  const settings = (organization.settings as Record<string, any>) ?? {};

  // If wizard already completed, go to overview
  if (settings.business_setup_wizard_completed_at) {
    redirect('/admin/overview');
  }

  // Check if template is confirmed (offices exist)
  const { count: officeCount } = await context.supabase
    .from('offices')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  const lifecycleState = getPlatformLifecycleState(settings, {
    hasExistingData: (officeCount ?? 0) > 0,
  });
  const confirmed = lifecycleState === 'template_confirmed';

  // Resolve vocabulary for labels
  const platformConfig = resolvePlatformConfig({ organizationSettings: settings });
  const vocabulary = platformConfig.experienceProfile.vocabulary;

  // If confirmed, fetch live data for team & launch steps
  let offices: any[] = [];
  let departments: any[] = [];
  let services: any[] = [];
  let desks: any[] = [];
  let staffList: any[] = [];
  let deskServices: any[] = [];

  if (confirmed) {
    const [officesRes, departmentsRes, servicesRes, desksRes, staffRes, deskServicesRes] =
      await Promise.all([
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
        context.supabase.from('desk_services').select('desk_id, service_id'),
      ]);

    offices = officesRes.data ?? [];
    const orgOfficeIds = new Set(offices.map((o: any) => o.id));
    departments = (departmentsRes.data ?? []).filter((d: any) => orgOfficeIds.has(d.office_id));
    const orgDeptIds = new Set(departments.map((d: any) => d.id));
    services = (servicesRes.data ?? []).filter((s: any) => orgDeptIds.has(s.department_id));
    desks = (desksRes.data ?? []).filter((d: any) => orgOfficeIds.has(d.office_id));
    staffList = staffRes.data ?? [];
    deskServices = deskServicesRes.data ?? [];
  }

  return (
    <SetupWizardClient
      organization={{ id: organization.id, name: organization.name }}
      confirmed={confirmed}
      trialSettings={settings}
      vocabulary={vocabulary}
      offices={offices}
      departments={departments}
      services={services}
      desks={desks}
      staffList={staffList}
      deskServices={deskServices}
    />
  );
}
