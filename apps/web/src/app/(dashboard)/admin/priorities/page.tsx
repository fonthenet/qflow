import { createClient } from '@/lib/supabase/server';
import { PrioritiesClient } from './priorities-client';

export default async function PrioritiesPage() {
  const supabase = await createClient();

  const { data: priorities, error } = await supabase
    .from('priority_categories')
    .select('*')
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
