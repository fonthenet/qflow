import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DeskPanel } from '@/components/desk/desk-panel';
import { DeskSelector } from '@/components/desk/desk-selector';

export default async function DeskPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Get staff profile
  const { data: staff } = await supabase
    .from('staff')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  // Find desk currently assigned to this staff member
  const { data: assignedDesk } = await supabase
    .from('desks')
    .select('*, department:departments(*)')
    .eq('current_staff_id', staff.id)
    .eq('is_active', true)
    .single();

  // If no desk assigned, show desk selection
  if (!assignedDesk) {
    // Fetch available desks for the staff member's office
    const officeId = staff.office_id;

    if (!officeId) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="rounded-full bg-warning/10 p-4 inline-flex mb-4">
              <svg
                className="h-8 w-8 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              No Office Assigned
            </h2>
            <p className="text-muted-foreground">
              You are not assigned to any office. Please contact your administrator
              to assign you to an office.
            </p>
          </div>
        </div>
      );
    }

    // Fetch available desks (not assigned to anyone or assigned to this staff)
    const { data: availableDesks } = await supabase
      .from('desks')
      .select('*, department:departments(*)')
      .eq('office_id', officeId)
      .eq('is_active', true)
      .is('current_staff_id', null)
      .order('name');

    return (
      <DeskSelector
        desks={availableDesks ?? []}
        staffId={staff.id}
        staffName={staff.full_name}
        officeId={officeId}
      />
    );
  }

  // Fetch current ticket being served or called at this desk
  const { data: currentTicket } = await supabase
    .from('tickets')
    .select('*')
    .eq('desk_id', assignedDesk.id)
    .in('status', ['called', 'serving'])
    .order('called_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch all departments and services for transfer functionality
  const { data: departments } = await supabase
    .from('departments')
    .select('*')
    .eq('office_id', assignedDesk.office_id)
    .eq('is_active', true)
    .order('name');

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('is_active', true)
    .order('name');

  return (
    <DeskPanel
      desk={{
        id: assignedDesk.id,
        name: assignedDesk.name,
        display_name: assignedDesk.display_name,
        department_id: assignedDesk.department_id,
        office_id: assignedDesk.office_id,
      }}
      staffId={staff.id}
      staffName={staff.full_name}
      departments={departments ?? []}
      services={services ?? []}
      initialCurrentTicket={currentTicket ?? null}
    />
  );
}
