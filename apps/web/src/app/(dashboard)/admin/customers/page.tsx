import { createClient } from '@/lib/supabase/server';
import { CustomersClient } from './customers-client';

export default async function CustomersPage() {
  const supabase = await createClient();

  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
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
