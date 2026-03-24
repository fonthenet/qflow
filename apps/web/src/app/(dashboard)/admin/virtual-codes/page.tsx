import { getStaffContext } from '@/lib/authz';
import { VirtualCodesClient } from './virtual-codes-client';

export default async function VirtualCodesPage() {
  const context = await getStaffContext();
  const scopedOfficeIds = context.accessibleOfficeIds;

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('id, name')
    .eq('id', context.staff.organization_id)
    .maybeSingle();

  let codesQuery = context.supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('organization_id', context.staff.organization_id)
    .order('created_at', { ascending: false });

  if (scopedOfficeIds.length > 0) {
    codesQuery = codesQuery.or(
      `office_id.is.null,office_id.in.(${scopedOfficeIds.join(',')})`
    );
  }

  const { data: codes, error } = scopedOfficeIds.length > 0 || context.staff.organization_id
    ? await codesQuery
    : { data: [], error: null };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">
          Failed to load virtual codes: {error.message}
        </p>
      </div>
    );
  }

  const { data: offices } = scopedOfficeIds.length > 0
    ? await context.supabase
        .from('offices')
        .select('id, name, organization_id')
        .in('id', scopedOfficeIds)
        .order('name')
    : { data: [] };

  const officeIds = (offices ?? []).map((office) => office.id);

  const { data: departments } = officeIds.length > 0
    ? await context.supabase
        .from('departments')
        .select('id, name, office_id')
        .in('office_id', officeIds)
        .order('name')
    : { data: [] };

  const departmentIds = (departments ?? []).map((department) => department.id);

  const { data: services } = departmentIds.length > 0
    ? await context.supabase
        .from('services')
        .select('id, name, department_id')
        .in('department_id', departmentIds)
        .order('name')
    : { data: [] };

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
