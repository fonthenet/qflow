import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { loadLocalEnv, shouldShowHelp } from './e2e-env';

type Supabase = ReturnType<typeof createServiceClient>;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createServiceClient() {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function deleteIfAny(
  supabase: Supabase,
  table: keyof Database['public']['Tables'],
  column: string,
  ids: string[]
) {
  if (ids.length === 0) {
    return;
  }

  const { error } = await supabase.from(table).delete().in(column, ids);
  if (error) {
    throw error;
  }
}

async function main() {
  loadLocalEnv();

  if (shouldShowHelp()) {
    console.log(`QueueFlow E2E reset

Required:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional:
  QFLO_E2E_ORG_SLUG
  QFLO_E2E_EMAIL
  QFLO_E2E_DROP_ORG
  QFLO_E2E_DROP_USER
`);
    return;
  }

  const supabase = createServiceClient();

  const organizationSlug = process.env.QFLO_E2E_ORG_SLUG ?? 'qflo-e2e';
  const dropOrganization = (process.env.QFLO_E2E_DROP_ORG ?? 'false') === 'true';
  const dropAdminUser = (process.env.QFLO_E2E_DROP_USER ?? 'false') === 'true';
  const adminEmail = process.env.QFLO_E2E_EMAIL ?? 'e2e-admin@qflo.local';

  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', organizationSlug)
    .maybeSingle();

  if (!organization) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          organizationSlug,
          message: 'No E2E organization found. Nothing to reset.',
        },
        null,
        2
      )
    );
    return;
  }

  const [{ data: offices }, { data: departments }, { data: services }, { data: desks }, { data: tickets }, { data: staff }] =
    await Promise.all([
      supabase.from('offices').select('id').eq('organization_id', organization.id),
      supabase
        .from('departments')
        .select('id')
        .in(
          'office_id',
          (await supabase.from('offices').select('id').eq('organization_id', organization.id)).data?.map((office) => office.id) ?? ['']
        ),
      supabase
        .from('services')
        .select('id')
        .in(
          'department_id',
          (
            await supabase
              .from('departments')
              .select('id')
              .in(
                'office_id',
                (await supabase.from('offices').select('id').eq('organization_id', organization.id)).data?.map((office) => office.id) ?? ['']
              )
          ).data?.map((department) => department.id) ?? ['']
        ),
      supabase
        .from('desks')
        .select('id')
        .in(
          'office_id',
          (await supabase.from('offices').select('id').eq('organization_id', organization.id)).data?.map((office) => office.id) ?? ['']
        ),
      supabase
        .from('tickets')
        .select('id')
        .in(
          'office_id',
          (await supabase.from('offices').select('id').eq('organization_id', organization.id)).data?.map((office) => office.id) ?? ['']
        ),
      supabase.from('staff').select('id, auth_user_id').eq('organization_id', organization.id),
    ]);

  const officeIds = offices?.map((office) => office.id) ?? [];
  const departmentIds = departments?.map((department) => department.id) ?? [];
  const serviceIds = services?.map((service) => service.id) ?? [];
  const deskIds = desks?.map((desk) => desk.id) ?? [];
  const ticketIds = tickets?.map((ticket) => ticket.id) ?? [];

  await deleteIfAny(supabase, 'notifications', 'ticket_id', ticketIds);
  await deleteIfAny(supabase, 'feedback', 'ticket_id', ticketIds);
  await deleteIfAny(supabase, 'ticket_events', 'ticket_id', ticketIds);
  await deleteIfAny(supabase, 'appointments', 'office_id', officeIds);
  await deleteIfAny(supabase, 'virtual_queue_codes', 'office_id', officeIds);
  await deleteIfAny(supabase, 'display_screens', 'office_id', officeIds);
  await deleteIfAny(supabase, 'intake_form_fields', 'service_id', serviceIds);
  await deleteIfAny(supabase, 'desk_services', 'desk_id', deskIds);
  await deleteIfAny(supabase, 'tickets', 'office_id', officeIds);
  await deleteIfAny(supabase, 'desks', 'office_id', officeIds);
  await deleteIfAny(supabase, 'services', 'department_id', departmentIds);
  await deleteIfAny(supabase, 'departments', 'office_id', officeIds);
  await deleteIfAny(supabase, 'customers', 'organization_id', [organization.id]);
  await deleteIfAny(supabase, 'translations', 'organization_id', [organization.id]);
  await deleteIfAny(supabase, 'priority_categories', 'organization_id', [organization.id]);
  await deleteIfAny(supabase, 'audit_logs', 'organization_id', [organization.id]);
  await deleteIfAny(supabase, 'template_health_snapshots', 'organization_id', [organization.id]);
  await deleteIfAny(supabase, 'offices', 'organization_id', [organization.id]);

  const { error: clearStaffError } = await supabase
    .from('staff')
    .update({
      office_id: null,
      department_id: null,
    })
    .eq('organization_id', organization.id);

  if (clearStaffError) {
    throw clearStaffError;
  }

  const { error: resetOrgError } = await supabase
    .from('organizations')
    .update({
      settings: {},
    })
    .eq('id', organization.id);

  if (resetOrgError) {
    throw resetOrgError;
  }

  if (dropOrganization) {
    const staffIds = staff?.map((entry) => entry.id) ?? [];
    if (staffIds.length > 0) {
      const { error: deleteStaffError } = await supabase.from('staff').delete().in('id', staffIds);
      if (deleteStaffError) {
        throw deleteStaffError;
      }
    }

    const { error: deleteOrganizationError } = await supabase
      .from('organizations')
      .delete()
      .eq('id', organization.id);

    if (deleteOrganizationError) {
      throw deleteOrganizationError;
    }
  }

  if (dropAdminUser && adminEmail) {
    const { data } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existing = data?.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase());
    if (existing) {
      await supabase.auth.admin.deleteUser(existing.id);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        organizationId: organization.id,
        organizationSlug,
        deletedOffices: officeIds.length,
        deletedDepartments: departmentIds.length,
        deletedServices: serviceIds.length,
        deletedDesks: deskIds.length,
        deletedTickets: ticketIds.length,
        droppedOrganization: dropOrganization,
        droppedAdminUser: dropAdminUser,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
