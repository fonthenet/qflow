import { getStaffContext } from '@/lib/authz';
import { PrioritiesClient } from './priorities-client';

export default async function PrioritiesPage() {
  const context = await getStaffContext();

  const { data: priorities, error } = await context.supabase
    .from('priority_categories')
    .select('*')
    .eq('organization_id', context.staff.organization_id)
    .order('weight', { ascending: false });

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">
          Failed to load priority categories: {error.message}
        </p>
      </div>
    );
  }

  return <PrioritiesClient priorities={priorities ?? []} />;
}
