import { getStaffContext, requireAdminMutationRole } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { BusinessMapClient } from './business-map-client';

export default async function OverviewPage() {
  const context = await getStaffContext();
  requireAdminMutationRole(context);

  const { data: org } = await context.supabase
    .from('organizations')
    .select('id, name, settings')
    .eq('id', context.staff.organization_id)
    .single();

  const platformConfig = resolvePlatformConfig({
    organizationSettings: ((org?.settings ?? {}) as Record<string, unknown>),
  });
  const vocabulary = platformConfig.experienceProfile.vocabulary;

  const [
    { data: offices },
    { data: departments },
    { data: desks },
    { data: services },
    { data: staffList },
  ] = await Promise.all([
    context.supabase
      .from('offices')
      .select('id, name, address, timezone, is_active')
      .in('id', context.accessibleOfficeIds)
      .order('name'),
    context.supabase
      .from('departments')
      .select('id, name, code, office_id, is_active, sort_order')
      .in('office_id', context.accessibleOfficeIds)
      .order('sort_order'),
    context.supabase
      .from('desks')
      .select('id, name, display_name, status, is_active, department_id, office_id, current_staff:staff(id, full_name)')
      .in('office_id', context.accessibleOfficeIds)
      .order('name'),
    context.supabase
      .from('services')
      .select('id, name, code, department_id, is_active, sort_order, estimated_service_time')
      .order('sort_order'),
    context.supabase
      .from('staff')
      .select('id, full_name, role, is_active, office_id, department_id')
      .eq('organization_id', context.staff.organization_id)
      .eq('is_active', true)
      .order('full_name'),
  ]);

  // Filter services to only those in accessible departments
  const accessibleDeptIds = new Set((departments ?? []).map((d) => d.id));
  const filteredServices = (services ?? []).filter((s) => accessibleDeptIds.has(s.department_id));

  // Normalize current_staff: Supabase returns it as array from join, but it's a single FK
  const normalizedDesks = (desks ?? []).map((d) => ({
    ...d,
    current_staff: Array.isArray(d.current_staff)
      ? (d.current_staff[0] ?? null)
      : (d.current_staff ?? null),
  }));

  // Build tree structure
  const officeTree = (offices ?? []).map((office) => {
    const officeDepts = (departments ?? []).filter((d) => d.office_id === office.id);
    return {
      ...office,
      departments: officeDepts.map((dept) => ({
        ...dept,
        desks: normalizedDesks.filter((d) => d.department_id === dept.id),
        services: filteredServices.filter((s) => s.department_id === dept.id),
      })),
    };
  });

  return (
    <BusinessMapClient
      organizationName={org?.name ?? 'Organization'}
      offices={officeTree}
      allStaff={staffList ?? []}
      vocabulary={vocabulary ?? {
        officeLabel: 'Office',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Desk',
        customerLabel: 'Customer',
        bookingLabel: 'Booking',
        queueLabel: 'Queue',
      }}
    />
  );
}
