import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DisplaysManager } from '@/components/admin/display-settings';

export default async function DisplaysAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  // Fetch offices for this org
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, is_active')
    .eq('organization_id', staff.organization_id)
    .order('name');

  // Fetch all display screens for this org's offices
  const officeIds = (offices ?? []).map((o) => o.id);
  const { data: screens } = officeIds.length > 0
    ? await supabase
        .from('display_screens')
        .select('*')
        .in('office_id', officeIds)
        .order('name')
    : { data: [] };

  // Fetch departments for department filtering
  const { data: departments } = officeIds.length > 0
    ? await supabase
        .from('departments')
        .select('id, name, code, office_id, is_active')
        .in('office_id', officeIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] };

  return (
    <DisplaysManager
      screens={screens ?? []}
      offices={offices ?? []}
      departments={departments ?? []}
    />
  );
}
