import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ADMIN_LIKE_ROLES, STAFF_ROLES } from '@queueflow/shared';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DeskPanel } from '@/components/desk/desk-panel';
import { DeskSelector } from '@/components/desk/desk-selector';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { getServerI18n } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t('My Desk'),
  };
}

export default async function DeskPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  return renderDeskPage(searchParams ? await searchParams : undefined);
}

async function renderDeskPage(searchParams?: { view?: string }) {
  const { t } = await getServerI18n();
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Get staff profile
  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, role, office_id, organization_id, auth_user_id')
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
              {t('No Office Assigned')}
            </h2>
            <p className="text-muted-foreground">
              {t('You are not assigned to any office. Please contact your administrator to assign you to an office.')}
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
        staffName={staff.full_name}
      />
    );
  }

  // Fetch current ticket being served or called at this desk
  const { data: currentTickets } = await supabase
    .from('tickets')
    .select('*')
    .eq('desk_id', assignedDesk.id)
    .in('status', ['called', 'serving'])
    .order('called_at', { ascending: false })
    .limit(1);
  const currentTicket = currentTickets?.[0] ?? null;

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

  const [{ data: organization }, { data: office }] = await Promise.all([
    staff.organization_id
      ? supabase
          .from('organizations')
          .select('settings')
          .eq('id', staff.organization_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('offices')
      .select('settings')
      .eq('id', assignedDesk.office_id)
      .maybeSingle(),
  ]);

  const platformConfig = resolvePlatformConfig({
    organizationSettings:
      (organization?.settings as Record<string, unknown> | null) ?? {},
    officeSettings: (office?.settings as Record<string, unknown> | null) ?? {},
  });

  const restaurantTables =
    platformConfig.selection.vertical === 'restaurant'
      ? (
          await createAdminClient()
            .from('restaurant_tables')
            .select('*')
            .eq('office_id', assignedDesk.office_id)
            .order('code')
        ).data ?? []
      : [];

  const { data: priorityCategories } =
    staff.organization_id
      ? await supabase
          .from('priority_categories')
          .select('id, name, icon, color')
          .eq('organization_id', staff.organization_id)
          .eq('is_active', true)
      : { data: [] as any[] };

  const { data: currentTicketFields } = currentTicket
    ? await supabase
        .from('intake_form_fields')
        .select('*')
        .eq('service_id', currentTicket.service_id)
        .order('sort_order', { ascending: true })
    : { data: [] as any[] };

  const customerDataScope = [...ADMIN_LIKE_ROLES, STAFF_ROLES.BRANCH_ADMIN].includes(
    staff.role as (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES]
  )
    ? 'admin'
    : 'staff';

  return (
    <DeskPanel
      desk={{
        id: assignedDesk.id,
        name: assignedDesk.name,
        display_name: assignedDesk.display_name,
        department_id: assignedDesk.department_id,
        office_id: assignedDesk.office_id,
      }}
      staffName={staff.full_name}
      departments={departments ?? []}
      services={services ?? []}
      priorityCategories={priorityCategories ?? []}
      currentTicketFields={currentTicketFields ?? []}
      customerDataScope={customerDataScope}
      initialCurrentTicket={currentTicket ?? null}
      restaurantTables={restaurantTables}
      platformContext={{
        vertical: platformConfig.selection.vertical,
        vocabulary: platformConfig.experienceProfile.vocabulary,
        officeSettings: platformConfig.officeSettings,
      }}
      initialDisplayMode={searchParams?.view === 'minimal' ? 'minimal' : 'normal'}
    />
  );
}
