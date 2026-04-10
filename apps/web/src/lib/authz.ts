import { ADMIN_LIKE_ROLES, STAFF_ROLES, type StaffRole } from '@qflo/shared';
import { createClient } from '@/lib/supabase/server';

type ScopeRole = StaffRole | string;
const ORGANIZATION_WIDE_ROLES = [
  STAFF_ROLES.ADMIN,
  STAFF_ROLES.MANAGER,
  STAFF_ROLES.ANALYST,
] as const;

export interface StaffContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  staff: {
    id: string;
    organization_id: string;
    office_id: string | null;
    department_id: string | null;
    role: string;
    full_name: string;
    email: string;
  };
  accessibleOfficeIds: string[];
}

type StaffProfile = StaffContext['staff'];

function isOfficeScopedRole(role: string) {
  return ([
    STAFF_ROLES.BRANCH_ADMIN,
    STAFF_ROLES.RECEPTIONIST,
    STAFF_ROLES.DESK_OPERATOR,
    STAFF_ROLES.FLOOR_MANAGER,
    STAFF_ROLES.AGENT,
  ] as string[]).includes(role);
}

export function isOrganizationWideRole(role: string) {
  return ORGANIZATION_WIDE_ROLES.includes(role as (typeof ORGANIZATION_WIDE_ROLES)[number]);
}

export async function resolveStaffProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string; email?: string | null }
): Promise<StaffProfile | null> {
  const { data: directStaff } = await supabase
    .from('staff')
    .select('id, organization_id, office_id, department_id, role, full_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (directStaff) {
    return directStaff;
  }

  if (!user.email) {
    return null;
  }

  const { data: matchedByEmail } = await supabase
    .from('staff')
    .select('id, organization_id, office_id, department_id, role, full_name, email, auth_user_id')
    .ilike('email', user.email)
    .maybeSingle();

  if (!matchedByEmail) {
    return null;
  }

  if (matchedByEmail.auth_user_id !== user.id) {
    await supabase
      .from('staff')
      .update({ auth_user_id: user.id })
      .eq('id', matchedByEmail.id);
  }

  return {
    id: matchedByEmail.id,
    organization_id: matchedByEmail.organization_id,
    office_id: matchedByEmail.office_id,
    department_id: matchedByEmail.department_id,
    role: matchedByEmail.role,
    full_name: matchedByEmail.full_name,
    email: matchedByEmail.email,
  };
}

export async function getStaffContext(): Promise<StaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Not authenticated');

  const staff = await resolveStaffProfile(supabase, user);

  if (!staff) {
    throw new Error(
      'Staff profile not found. This account is signed in, but it is not linked to a business team record yet.'
    );
  }

  const accessibleOfficeIds =
    ADMIN_LIKE_ROLES.includes(staff.role as StaffRole) || staff.role === STAFF_ROLES.ANALYST
      ? (
          await supabase
            .from('offices')
            .select('id')
            .eq('organization_id', staff.organization_id)
        ).data?.map((office) => office.id) ?? []
      : staff.office_id
        ? [staff.office_id]
        : [];

  return {
    supabase,
    userId: user.id,
    staff,
    accessibleOfficeIds,
  };
}

export function isStaffLinkError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('not linked to a business team record yet')
  );
}

export function requireRole(context: StaffContext, allowedRoles: ScopeRole[]) {
  if (!allowedRoles.includes(context.staff.role)) {
    throw new Error('You do not have permission to perform this action');
  }
}

export function requireAdminMutationRole(context: StaffContext) {
  requireRole(context, [
    STAFF_ROLES.ADMIN,
    STAFF_ROLES.MANAGER,
    STAFF_ROLES.BRANCH_ADMIN,
  ]);
}

export function requireOfficeMembership(context: StaffContext) {
  if (isOfficeScopedRole(context.staff.role) && !context.staff.office_id) {
    throw new Error('Your staff profile is not assigned to an office');
  }
}

export function canAccessOffice(context: StaffContext, officeId: string) {
  return context.accessibleOfficeIds.includes(officeId);
}

export async function requireOfficeAccess(context: StaffContext, officeId: string) {
  if (!canAccessOffice(context, officeId)) {
    throw new Error('You do not have access to this office');
  }
}

export async function requireOrganizationAdmin(context: StaffContext) {
  requireRole(context, [STAFF_ROLES.ADMIN, STAFF_ROLES.MANAGER]);
}

export function requireAnalyticsAccess(context: StaffContext) {
  requireRole(context, [
    STAFF_ROLES.ADMIN,
    STAFF_ROLES.MANAGER,
    STAFF_ROLES.BRANCH_ADMIN,
    STAFF_ROLES.FLOOR_MANAGER,
    STAFF_ROLES.ANALYST,
  ]);
}

export function requireAuditAccess(context: StaffContext) {
  requireRole(context, [
    STAFF_ROLES.ADMIN,
    STAFF_ROLES.MANAGER,
    STAFF_ROLES.BRANCH_ADMIN,
    STAFF_ROLES.ANALYST,
  ]);
}

export async function getOfficeById(context: StaffContext, officeId: string) {
  const { data: office } = await context.supabase
    .from('offices')
    .select('id, name, organization_id, settings')
    .eq('id', officeId)
    .single();

  if (!office || office.organization_id !== context.staff.organization_id) {
    throw new Error('Office not found in your organization');
  }

  await requireOfficeAccess(context, office.id);
  return office;
}

export async function getDepartmentById(context: StaffContext, departmentId: string) {
  const { data: department } = await context.supabase
    .from('departments')
    .select('id, office_id, office:offices(id, organization_id)')
    .eq('id', departmentId)
    .single();

  const office = Array.isArray(department?.office) ? department?.office[0] : department?.office;
  if (!department || !office || office.organization_id !== context.staff.organization_id) {
    throw new Error('Department not found in your organization');
  }

  await requireOfficeAccess(context, department.office_id);
  return {
    id: department.id,
    office_id: department.office_id,
  };
}

export async function getServiceById(context: StaffContext, serviceId: string) {
  const { data: service } = await context.supabase
    .from('services')
    .select('id, department_id, department:departments(id, office_id, office:offices(id, organization_id))')
    .eq('id', serviceId)
    .single();

  const department = Array.isArray(service?.department) ? service?.department[0] : service?.department;
  const office = Array.isArray(department?.office) ? department?.office[0] : department?.office;
  if (!service || !department || !office || office.organization_id !== context.staff.organization_id) {
    throw new Error('Service not found in your organization');
  }

  await requireOfficeAccess(context, department.office_id);
  return {
    id: service.id,
    department_id: department.id,
    office_id: department.office_id,
  };
}

export async function getDeskById(context: StaffContext, deskId: string) {
  const { data: desk } = await context.supabase
    .from('desks')
    .select('id, office_id, department_id, current_staff_id, name, display_name')
    .eq('id', deskId)
    .single();

  if (!desk) throw new Error('Desk not found');
  await getOfficeById(context, desk.office_id);
  return desk;
}

export async function getDisplayById(context: StaffContext, displayId: string) {
  const { data: display } = await context.supabase
    .from('display_screens')
    .select('id, office_id')
    .eq('id', displayId)
    .single();

  if (!display) throw new Error('Display screen not found');
  await getOfficeById(context, display.office_id);
  return display;
}

export async function getTicketById(context: StaffContext, ticketId: string) {
  const { data: ticket } = await context.supabase
    .from('tickets')
    .select('id, office_id, desk_id, status, ticket_number, parked_at')
    .eq('id', ticketId)
    .single();

  if (!ticket) throw new Error('Ticket not found');
  await requireOfficeAccess(context, ticket.office_id);
  return ticket;
}

export async function requireDeskOperatorForDesk(context: StaffContext, deskId: string) {
  requireOfficeMembership(context);
  const desk = await getDeskById(context, deskId);

  if (
    context.staff.role !== STAFF_ROLES.ADMIN &&
    context.staff.role !== STAFF_ROLES.MANAGER &&
    context.staff.role !== STAFF_ROLES.BRANCH_ADMIN &&
    context.staff.role !== STAFF_ROLES.FLOOR_MANAGER &&
    desk.current_staff_id !== context.staff.id
  ) {
    throw new Error('You are not assigned to this desk');
  }

  return desk;
}
