import { redirect } from 'next/navigation';
import { getStaffContext, isStaffLinkError } from '@/lib/authz';
import { OfficesClient } from './offices-client';

export default async function OfficesPage() {
  let context;
  try {
    context = await getStaffContext();
  } catch (error) {
    if (isStaffLinkError(error)) {
      redirect('/account-not-linked');
    }

    throw error;
  }

  const { data: offices, error } = context.accessibleOfficeIds.length > 0
    ? await context.supabase
        .from('offices')
        .select('*')
        .in('id', context.accessibleOfficeIds)
        .order('name')
    : { data: [], error: null };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load offices: {error.message}</p>
      </div>
    );
  }

  return <OfficesClient offices={offices ?? []} />;
}
