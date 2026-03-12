import { createClient } from '@/lib/supabase/server';
import { OfficesClient } from './offices-client';

export default async function OfficesPage() {
  const supabase = await createClient();

  const { data: offices, error } = await supabase
    .from('offices')
    .select('*')
    .order('name');

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Failed to load offices: {error.message}</p>
      </div>
    );
  }

  return <OfficesClient offices={offices ?? []} />;
}
