import { getStaffContext } from '@/lib/authz';
import { ServicesClient } from './services-client';
import { PageTabs } from '@/components/layout/page-tabs';
import { STRUCTURE_TABS } from '@/components/layout/admin-nav-groups';

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const context = await getStaffContext();
  const params = await searchParams;
  const officeIds = context.accessibleOfficeIds;

  const { data: departments } = officeIds.length > 0
    ? await context.supabase
        .from('departments')
        .select('id, name, office_id, office:offices(id, name)')
        .in('office_id', officeIds)
        .order('name')
    : { data: [] };

  const allowedDepartmentIds = (departments ?? []).map((department) => department.id);

  const scopedDepartmentIds = params.department
    ? allowedDepartmentIds.includes(params.department)
      ? [params.department]
      : []
    : allowedDepartmentIds;

  const { data: services, error } = scopedDepartmentIds.length > 0
    ? await context.supabase
        .from('services')
        .select('*, department:departments(id, name, office:offices(id, name))')
        .in('department_id', scopedDepartmentIds)
        .order('name')
    : { data: [], error: null };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load services: {error.message}</p>
      </div>
    );
  }

  return (
    <>
      <PageTabs tabs={STRUCTURE_TABS} />
      <ServicesClient
        services={services ?? []}
        departments={departments ?? []}
        currentDepartmentFilter={params.department ?? ''}
      />
    </>
  );
}
