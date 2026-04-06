import { getBroadcastTemplates } from '@/lib/actions/broadcast-actions';
import BroadcastClient from './broadcast-client';
import { getStaffContext } from '@/lib/authz';

export default async function BroadcastPage() {
  const context = await getStaffContext();
  const { templates } = await getBroadcastTemplates();

  // Fetch offices for the office filter dropdown
  const { data: offices } = await context.supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', context.staff.organization_id)
    .order('name');

  return (
    <BroadcastClient
      initialTemplates={templates ?? []}
      offices={offices ?? []}
    />
  );
}
