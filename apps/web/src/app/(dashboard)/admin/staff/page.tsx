import { createClient } from '@/lib/supabase/server';
import { StaffClient } from './staff-client';

export default async function StaffPage() {
  const supabase = await createClient();

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name')
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office:offices(id, name)')
    .order('name');

  const { data: staff, error } = await supabase
    .from('staff')
    .select('*, office:offices(id, name), department:departments(id, name)')
    .order('full_name');

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load staff: {error.message}</p>
      </div>
    );
  }

  return (
    <StaffClient
      staff={staff ?? []}
      offices={offices ?? []}
      departments={departments ?? []}
    />
  );
}
