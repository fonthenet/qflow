import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CalendarView } from '@/components/admin/calendar/calendar-view';

export default async function AdminCalendarPage() {
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

  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, is_active, timezone, operating_hours, settings')
    .eq('organization_id', staff.organization_id)
    .eq('is_active', true)
    .order('name');

  const officeIds = (offices ?? []).map((o) => o.id);

  const { data: departments } = officeIds.length
    ? await supabase
        .from('departments')
        .select('id, name, code, office_id, is_active, sort_order')
        .in('office_id', officeIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] as any[] };

  const { data: services } = officeIds.length
    ? await supabase
        .from('services')
        .select('id, name, code, department_id, color, estimated_service_time, is_active, sort_order')
        .in(
          'department_id',
          (departments ?? []).map((d) => d.id)
        )
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] as any[] };

  const { data: staffMembers } = await supabase
    .from('staff')
    .select('id, full_name, role, is_active')
    .eq('organization_id', staff.organization_id)
    .eq('is_active', true)
    .order('full_name');

  return (
    <CalendarView
      offices={offices ?? []}
      departments={departments ?? []}
      services={services ?? []}
      staffMembers={staffMembers ?? []}
    />
  );
}
