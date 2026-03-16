import { getStaffContext } from '@/lib/authz';
import { DepartmentsClient } from './departments-client';

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const context = await getStaffContext();
  const params = await searchParams;

  const officeIds = params.office
    ? context.accessibleOfficeIds.includes(params.office)
      ? [params.office]
      : []
    : context.accessibleOfficeIds;

  const { data: offices } = officeIds.length > 0
    ? await context.supabase
        .from('offices')
        .select('id, name')
        .in('id', officeIds)
        .order('name')
    : { data: [] };

  const { data: departments, error } = officeIds.length > 0
    ? await context.supabase
        .from('departments')
        .select('*, office:offices(id, name)')
        .in('office_id', officeIds)
        .order('name')
    : { data: [], error: null };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load departments: {error.message}</p>
      </div>
    );
  }

  return (
    <DepartmentsClient
      departments={departments ?? []}
      offices={offices ?? []}
      currentOfficeFilter={params.office ?? ''}
    />
  );
}
