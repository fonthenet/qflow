import { getStaffContext } from '@/lib/authz';
import { VirtualCodesClient } from './virtual-codes-client';

export default async function VirtualCodesPage() {
  const context = await getStaffContext();
  const orgId = context.staff.organization_id;

  const { data: codes, error } = await context.supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('organization_id', orgId)
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

  const { data: offices } = await context.supabase
    .from('offices')
    .select('id, name, organization_id')
    .eq('organization_id', orgId)
    .order('name');

  const { data: departments } = await context.supabase
    .from('departments')
    .select('id, name, office_id')
    .in('office_id', context.accessibleOfficeIds)
    .order('name');

  const { data: services } = await context.supabase
    .from('services')
    .select('id, name, department_id')
    .order('name');

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

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
