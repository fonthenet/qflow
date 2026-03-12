import { createClient } from '@/lib/supabase/server';
import { ServicesClient } from './services-client';

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office:offices(id, name)')
    .order('name');

  let query = supabase
    .from('services')
    .select('*, department:departments(id, name, office:offices(id, name))')
    .order('name');

  if (params.department) {
    query = query.eq('department_id', params.department);
  }

  const { data: services, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load services: {error.message}</p>
      </div>
    );
  }

  return (
    <ServicesClient
      services={services ?? []}
      departments={departments ?? []}
      currentDepartmentFilter={params.department ?? ''}
    />
  );
}
