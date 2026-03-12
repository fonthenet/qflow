import { createClient } from '@/lib/supabase/server';
import { DesksClient } from './desks-client';

export default async function DesksPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string; department?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office_id, office:offices(id, name)')
    .order('name');

  const { data: staffList } = await supabase
    .from('staff')
    .select('id, full_name, office_id')
    .eq('is_active', true)
    .order('full_name');

  let query = supabase
    .from('desks')
    .select(
      '*, department:departments(id, name), office:offices(id, name), current_staff:staff(id, full_name)'
    )
    .order('name');

  if (params.office) {
    query = query.eq('office_id', params.office);
  }
  if (params.department) {
    query = query.eq('department_id', params.department);
  }

  const { data: desks, error } = await query;

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
    />
  );
}
