import { getStaffContext } from '@/lib/authz';
import { CustomersClient } from './customers-client';

export default async function CustomersPage() {
  const context = await getStaffContext();

  const { data: customers, error } = await context.supabase
    .from('customers')
    .select('*')
    .eq('organization_id', context.staff.organization_id)
    .order('last_visit_at', { ascending: false });

  if (error) {
    return (
      <div className="p-6 text-red-500">
        Failed to load customers: {error.message}
      </div>
    );
  }

  return <CustomersClient customers={customers ?? []} />;
}
