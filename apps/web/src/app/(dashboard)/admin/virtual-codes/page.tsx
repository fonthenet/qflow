import { createClient } from '@/lib/supabase/server';
import { VirtualCodesClient } from './virtual-codes-client';

export default async function VirtualCodesPage() {
  const supabase = await createClient();

  const { data: codes, error } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">
          Failed to load virtual codes: {error.message}
        </p>
      </div>
    );
  }

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, organization_id')
    .order('name');

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, office_id')
    .order('name');

  const { data: services } = await supabase
    .from('services')
    .select('id, name, department_id')
    .order('name');

  let organization: { id: string; name: string } | null = null;
  const organizationId = offices?.[0]?.organization_id;

  if (organizationId) {
    const { data: organizationRow } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', organizationId)
      .maybeSingle();

    if (organizationRow) {
      organization = organizationRow;
    }
  }

  return (
    <VirtualCodesClient
      codes={codes ?? []}
      offices={offices ?? []}
      departments={departments ?? []}
      services={services ?? []}
      organization={organization}
    />
  );
}
