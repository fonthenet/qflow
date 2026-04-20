import { getStaffContext } from '@/lib/authz';
import { PrioritiesClient } from './priorities-client';
import { PageTabs } from '@/components/layout/page-tabs';
import { STRUCTURE_TABS } from '@/components/layout/admin-nav-groups';

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

  return (
    <>
      <PageTabs tabs={STRUCTURE_TABS} />
      <PrioritiesClient priorities={priorities ?? []} />
    </>
  );
}
