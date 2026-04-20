import { getStaffContext } from '@/lib/authz';
import { DesksClient } from './desks-client';
import { PageTabs } from '@/components/layout/page-tabs';
import { STRUCTURE_TABS } from '@/components/layout/admin-nav-groups';

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

  // Load staff across ALL accessible offices (not only the filtered one).
  // The Roster view and cross-office picker need the full list, and we also
  // want to surface staff with no office (or an orphaned closed office) so
  // admins can fix them instead of them disappearing silently.
  const { data: staffList } = context.accessibleOfficeIds.length > 0
    ? await context.supabase
        .from('staff')
        .select('id, full_name, office_id, is_active, office:offices(id, name, is_active)')
        .eq('organization_id', context.staff.organization_id)
        .eq('is_active', true)
        .order('full_name')
    : { data: [] };

  const staffListNormalized = (staffList ?? []).map((s) => ({
    ...s,
    office: Array.isArray(s.office) ? s.office[0] ?? null : s.office,
  }));

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
    <>
      <PageTabs tabs={STRUCTURE_TABS} />
      <DesksClient
        desks={desks ?? []}
        offices={offices ?? []}
        departments={departments ?? []}
        staffList={staffListNormalized}
        currentOfficeFilter={params.office ?? ''}
        currentDepartmentFilter={params.department ?? ''}
        currentUserRole={context.staff.role}
      />
    </>
  );
}
