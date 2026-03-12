import { createClient } from '@/lib/supabase/server';
import { DepartmentsClient } from './departments-client';

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .order('name');

  let query = supabase
    .from('departments')
    .select('*, office:offices(id, name)')
    .order('name');

  if (params.office) {
    query = query.eq('office_id', params.office);
  }

  const { data: departments, error } = await query;

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
