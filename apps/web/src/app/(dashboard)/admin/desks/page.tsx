import { getStaffContext } from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { DesksClient } from './desks-client';

export default async function DesksPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string; department?: string }>;
}) {
  const context = await getStaffContext();
  const params = await searchParams;
  const requestedOfficeIds = params.office
    ? context.accessibleOfficeIds.includes(params.office)
      ? [params.office]
      : []
    : context.accessibleOfficeIds;

  const { data: org } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', context.staff.organization_id)
    .single();
  const platformConfig = resolvePlatformConfig({ organizationSettings: (org?.settings ?? {}) as Record<string, unknown> });
  const vocabulary = platformConfig.experienceProfile.vocabulary;
  const deskLabel = vocabulary?.deskLabel ?? 'Counter';
  const customerLabel = vocabulary?.customerLabel ?? 'Customer';

  const { data: offices } = requestedOfficeIds.length > 0
    ? await context.supabase
        .from('offices')
        .select('id, name')
        .in('id', requestedOfficeIds)
        .order('name')
    : { data: [] };

  const { data: departments } = requestedOfficeIds.length > 0
    ? await context.supabase
        .from('departments')
        .select('id, name, office_id, office:offices(id, name)')
        .in('office_id', requestedOfficeIds)
        .order('name')
    : { data: [] };

  const { data: staffList } = requestedOfficeIds.length > 0
    ? await context.supabase
        .from('staff')
        .select('id, full_name, office_id')
        .eq('is_active', true)
        .in('office_id', requestedOfficeIds)
        .order('full_name')
    : { data: [] };

  let desksQuery = context.supabase
    .from('desks')
    .select(
      '*, department:departments(id, name), office:offices(id, name), current_staff:staff(id, full_name)'
    )
    .order('name');

  if (requestedOfficeIds.length > 0) {
    desksQuery = desksQuery.in('office_id', requestedOfficeIds);
  }
  if (params.department) {
    desksQuery = desksQuery.eq('department_id', params.department);
  }

  const { data: desks, error } = requestedOfficeIds.length > 0
    ? await desksQuery
    : { data: [], error: null };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load desks: {error.message}</p>
      </div>
    );
  }

  return (
    <DesksClient
      desks={desks ?? []}
      offices={offices ?? []}
      departments={departments ?? []}
      staffList={staffList ?? []}
      currentOfficeFilter={params.office ?? ''}
      currentDepartmentFilter={params.department ?? ''}
      deskLabel={deskLabel}
      customerLabel={customerLabel}
    />
  );
}
