'use server';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { logAuditEvent } from '@/lib/audit';
import {
  getDepartmentById,
  getDeskById,
  getDisplayById,
  getOfficeById,
  getServiceById,
  getStaffContext,
  requireAdminMutationRole,
  requireOfficeAccess,
  requireOrganizationAdmin,
  type StaffContext,
} from '@/lib/authz';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { createAdminClient } from '@/lib/supabase/admin';

type AnyRecord = Record<string, unknown>;

async function getAdminContext() {
  const context = await getStaffContext();
  requireAdminMutationRole(context);
  return context;
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

async function assertDepartmentInOffice(
  context: StaffContext,
  departmentId: string,
  officeId: string
) {
  const department = await getDepartmentById(context, departmentId);
  if (department.office_id !== officeId) {
    throw new Error('Department does not belong to the selected office');
  }

  return department;
}

async function assertStaffAssignment(
  context: StaffContext,
  staffId: string | null,
  officeId: string
) {
  if (!staffId) return null;

  const { data: staff } = await context.supabase
    .from('staff')
    .select('id, organization_id, office_id')
    .eq('id', staffId)
    .single();

  if (!staff || staff.organization_id !== context.staff.organization_id) {
    throw new Error('Assigned staff member was not found in your organization');
  }

  if (staff.office_id && staff.office_id !== officeId) {
    throw new Error('Assigned staff member must belong to the same office');
  }

  return staff;
}

async function getPriorityCategory(
  context: StaffContext,
  id: string
) {
  const { data: priority } = await context.supabase
    .from('priority_categories')
    .select('id, name, organization_id')
    .eq('id', id)
    .single();

  if (!priority || priority.organization_id !== context.staff.organization_id) {
    throw new Error('Priority category not found in your organization');
  }

  return priority;
}

async function getStaffMember(
  context: StaffContext,
  id: string
) {
  const { data: staffMember } = await context.supabase
    .from('staff')
    .select('id, auth_user_id, organization_id, office_id, department_id, full_name, role, email')
    .eq('id', id)
    .single();

  if (!staffMember || staffMember.organization_id !== context.staff.organization_id) {
    throw new Error('Staff member not found in your organization');
  }

  return staffMember;
}

function getOfficeSettingsFromForm(formData: FormData, currentSettings: AnyRecord = {}) {
  const country = (formData.get('country') as string) || null;
  return {
    ...currentSettings,
    branch_type: (formData.get('branch_type') as string) || null,
    country_code: country, // derived from country selector for phone normalization
    platform_operating_model: (formData.get('platform_operating_model') as string) || null,
    privacy_safe_display: formData.get('privacy_safe_display') === 'true',
  };
}

function normalizeOfficeTimezone(rawTimezone: string | null | undefined) {
  const timezone = (rawTimezone ?? '').trim();
  if (!timezone) return null;

  const aliases: Record<string, string> = {
    'Europe/Algiers': 'Africa/Algiers',
  };

  return aliases[timezone] ?? timezone;
}

function getOperatingHoursFromForm(formData: FormData) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const operatingHours: Record<string, { open: string; close: string }> = {};

  days.forEach((day) => {
    const closed = formData.get(`${day}_closed`) === 'true';
    const open = (formData.get(`${day}_open`) as string) || '08:00';
    const close = (formData.get(`${day}_close`) as string) || '17:00';
    operatingHours[day] = closed ? { open: '00:00', close: '00:00' } : { open, close };
  });

  return operatingHours;
}

// ─── Offices ────────────────────────────────────────────────────────────────

export async function createOffice(formData: FormData) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);

  const settings = getOfficeSettingsFromForm(formData);

  const { data: office, error } = await context.supabase
    .from('offices')
    .insert({
      name: formData.get('name') as string,
      address: (formData.get('address') as string) || null,
      wilaya: (formData.get('wilaya') as string) || null,
      city: (formData.get('city') as string) || null,
      country: (formData.get('country') as string) || null,
      timezone: normalizeOfficeTimezone(formData.get('timezone') as string),
      operating_hours: getOperatingHoursFromForm(formData),
      is_active: formData.get('is_active') === 'true',
      organization_id: context.staff.organization_id,
      settings,
    } as any)
    .select('id, name')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'office_created',
    entityType: 'office',
    entityId: office.id,
    officeId: office.id,
    summary: `Created office ${office.name}`,
    metadata: settings,
  });

  revalidatePath('/admin/offices');
  return { success: true };
}

export async function updateOffice(id: string, formData: FormData) {
  const context = await getAdminContext();
  const office = await getOfficeById(context, id);
  const currentSettings = (office.settings as AnyRecord | null) ?? {};
  const settings = getOfficeSettingsFromForm(formData, currentSettings);

  const { data: updatedOffice, error } = await context.supabase
    .from('offices')
    .update({
      name: formData.get('name') as string,
      address: (formData.get('address') as string) || null,
      wilaya: (formData.get('wilaya') as string) || null,
      city: (formData.get('city') as string) || null,
      country: (formData.get('country') as string) || null,
      timezone: normalizeOfficeTimezone(formData.get('timezone') as string),
      operating_hours: getOperatingHoursFromForm(formData),
      is_active: formData.get('is_active') === 'true',
      settings,
    } as any)
    .eq('id', id)
    .select('id, name')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'office_updated',
    entityType: 'office',
    entityId: id,
    officeId: id,
    summary: `Updated office ${updatedOffice.name}`,
    metadata: settings,
  });

  revalidatePath('/admin/offices');
  return { success: true };
}

export async function deleteOffice(id: string) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const office = await getOfficeById(context, id);

  const { error } = await context.supabase.from('offices').delete().eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'office_deleted',
    entityType: 'office',
    entityId: id,
    officeId: id,
    summary: `Deleted office ${office.name}`,
    metadata: { previousSettings: office.settings ?? {} },
  });

  revalidatePath('/admin/offices');
  return { success: true };
}

// ─── Virtual Codes ──────────────────────────────────────────────────────────

export async function createVirtualCode(formData: FormData) {
  const context = await getAdminContext();
  const scope = (formData.get('scope') as string) || 'department';
  const officeId = (formData.get('office_id') as string) || null;
  const departmentId = (formData.get('department_id') as string) || null;
  const serviceId = (formData.get('service_id') as string) || null;

  if (scope === 'business') {
    await requireOrganizationAdmin(context);
  }

  if (scope !== 'business' && !officeId) {
    return { error: 'Office is required for this code scope' };
  }

  if ((scope === 'department' || scope === 'service') && !departmentId) {
    return { error: 'Department is required for this code scope' };
  }

  if (scope === 'service' && !serviceId) {
    return { error: 'Service is required for this code scope' };
  }

  if (officeId) {
    await getOfficeById(context, officeId);
  }

  if (departmentId && officeId) {
    await assertDepartmentInOffice(context, departmentId, officeId);
  }

  if (serviceId && departmentId) {
    const service = await getServiceById(context, serviceId);
    if (service.department_id !== departmentId) {
      return { error: 'Service does not belong to the selected department' };
    }
  }

  const insertData = {
    organization_id: context.staff.organization_id,
    office_id: scope === 'business' ? null : officeId,
    department_id:
      scope === 'department' || scope === 'service' ? departmentId : null,
    service_id: scope === 'service' ? serviceId : null,
    qr_token: nanoid(16),
    is_active: true,
  };

  const { data: code, error } = await context.supabase
    .from('virtual_queue_codes')
    .insert(insertData)
    .select('*')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'virtual_code_created',
    entityType: 'virtual_code',
    entityId: code.id,
    officeId: code.office_id ?? undefined,
    summary: 'Created virtual join link',
    metadata: {
      scope,
      officeId: code.office_id,
      departmentId: code.department_id,
      serviceId: code.service_id,
    },
  });

  revalidatePath('/admin/virtual-codes');
  return { success: true, code };
}

async function getVirtualCodeForMutation(context: StaffContext, id: string) {
  const { data: code } = await context.supabase
    .from('virtual_queue_codes')
    .select('id, organization_id, office_id, department_id, service_id, qr_token, is_active')
    .eq('id', id)
    .single();

  if (!code || code.organization_id !== context.staff.organization_id) {
    throw new Error('Virtual code not found in your organization');
  }

  if (code.office_id) {
    await requireOfficeAccess(context, code.office_id);
  } else {
    await requireOrganizationAdmin(context);
  }

  return code;
}

export async function toggleVirtualCode(id: string, isActive: boolean) {
  const context = await getAdminContext();
  await getVirtualCodeForMutation(context, id);

  const { error } = await context.supabase
    .from('virtual_queue_codes')
    .update({ is_active: isActive })
    .eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: isActive ? 'virtual_code_activated' : 'virtual_code_deactivated',
    entityType: 'virtual_code',
    entityId: id,
    summary: `${isActive ? 'Activated' : 'Deactivated'} virtual join link`,
  });

  revalidatePath('/admin/virtual-codes');
  return { success: true };
}

export async function deleteVirtualCode(id: string) {
  const context = await getAdminContext();
  const code = await getVirtualCodeForMutation(context, id);

  const { error } = await context.supabase
    .from('virtual_queue_codes')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'virtual_code_deleted',
    entityType: 'virtual_code',
    entityId: id,
    officeId: code.office_id ?? undefined,
    summary: 'Deleted virtual join link',
    metadata: {
      departmentId: code.department_id,
      serviceId: code.service_id,
      qrToken: code.qr_token,
    },
  });

  revalidatePath('/admin/virtual-codes');
  return { success: true };
}

// ─── Departments ────────────────────────────────────────────────────────────

export async function createDepartment(formData: FormData) {
  const context = await getAdminContext();
  const officeId = formData.get('office_id') as string;
  await getOfficeById(context, officeId);

  const { data: department, error } = await context.supabase
    .from('departments')
    .insert({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      office_id: officeId,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : null,
    })
    .select('id, name, office_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'department_created',
    entityType: 'department',
    entityId: department.id,
    officeId: department.office_id,
    summary: `Created department ${department.name}`,
    metadata: {
      code: formData.get('code'),
      sortOrder: formData.get('sort_order'),
    },
  });

  revalidatePath('/admin/departments');
  return { success: true };
}

export async function updateDepartment(id: string, formData: FormData) {
  const context = await getAdminContext();
  const currentDepartment = await getDepartmentById(context, id);
  const officeId = formData.get('office_id') as string;
  await getOfficeById(context, officeId);

  const { data: department, error } = await context.supabase
    .from('departments')
    .update({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      office_id: officeId,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : null,
    })
    .eq('id', id)
    .select('id, name, office_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'department_updated',
    entityType: 'department',
    entityId: department.id,
    officeId: department.office_id,
    summary: `Updated department ${department.name}`,
    metadata: {
      previousOfficeId: currentDepartment.office_id,
      nextOfficeId: officeId,
      code: formData.get('code'),
    },
  });

  revalidatePath('/admin/departments');
  return { success: true };
}

export async function deleteDepartment(id: string) {
  const context = await getAdminContext();
  const department = await getDepartmentById(context, id);

  const { error } = await context.supabase.from('departments').delete().eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'department_deleted',
    entityType: 'department',
    entityId: id,
    officeId: department.office_id,
    summary: `Deleted department ${id}`,
    metadata: {},
  });

  revalidatePath('/admin/departments');
  return { success: true };
}

// ─── Services ───────────────────────────────────────────────────────────────

export async function createService(formData: FormData) {
  const context = await getAdminContext();
  const departmentId = formData.get('department_id') as string;
  const department = await getDepartmentById(context, departmentId);

  const { data: service, error } = await context.supabase
    .from('services')
    .insert({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      department_id: departmentId,
      estimated_service_time: formData.get('estimated_service_time')
        ? Number(formData.get('estimated_service_time'))
        : null,
      priority: formData.get('priority') ? Number(formData.get('priority')) : null,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : null,
    })
    .select('id, name, department_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'service_created',
    entityType: 'service',
    entityId: service.id,
    officeId: department.office_id,
    summary: `Created service ${service.name}`,
    metadata: {
      code: formData.get('code'),
      departmentId,
      estimatedServiceTime: formData.get('estimated_service_time'),
    },
  });

  revalidatePath('/admin/services');
  return { success: true };
}

export async function updateService(id: string, formData: FormData) {
  const context = await getAdminContext();
  const currentService = await getServiceById(context, id);
  const departmentId = formData.get('department_id') as string;
  const department = await getDepartmentById(context, departmentId);

  const { data: service, error } = await context.supabase
    .from('services')
    .update({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      department_id: departmentId,
      estimated_service_time: formData.get('estimated_service_time')
        ? Number(formData.get('estimated_service_time'))
        : null,
      priority: formData.get('priority') ? Number(formData.get('priority')) : null,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : null,
    })
    .eq('id', id)
    .select('id, name, department_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'service_updated',
    entityType: 'service',
    entityId: service.id,
    officeId: department.office_id,
    summary: `Updated service ${service.name}`,
    metadata: {
      previousDepartmentId: currentService.department_id,
      nextDepartmentId: departmentId,
      code: formData.get('code'),
    },
  });

  revalidatePath('/admin/services');
  return { success: true };
}

export async function deleteService(id: string) {
  const context = await getAdminContext();
  const service = await getServiceById(context, id);

  const { error } = await context.supabase.from('services').delete().eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'service_deleted',
    entityType: 'service',
    entityId: id,
    officeId: service.office_id,
    summary: `Deleted service ${id}`,
    metadata: {},
  });

  revalidatePath('/admin/services');
  return { success: true };
}

// ─── Desks ──────────────────────────────────────────────────────────────────

export async function createDesk(formData: FormData) {
  const context = await getAdminContext();
  const officeId = formData.get('office_id') as string;
  const departmentId = formData.get('department_id') as string;
  await getOfficeById(context, officeId);
  await assertDepartmentInOffice(context, departmentId, officeId);
  await assertStaffAssignment(
    context,
    (formData.get('current_staff_id') as string) || null,
    officeId
  );

  const { data: desk, error } = await context.supabase
    .from('desks')
    .insert({
      name: formData.get('name') as string,
      display_name: (formData.get('display_name') as string) || null,
      office_id: officeId,
      department_id: departmentId,
      current_staff_id: (formData.get('current_staff_id') as string) || null,
      status: (formData.get('status') as string) || 'closed',
      is_active: formData.get('is_active') === 'true',
    })
    .select('id, name, office_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'desk_created',
    entityType: 'desk',
    entityId: desk.id,
    officeId: desk.office_id,
    summary: `Created desk ${desk.name}`,
    metadata: {
      departmentId,
      currentStaffId: (formData.get('current_staff_id') as string) || null,
    },
  });

  revalidatePath('/admin/desks');
  return { success: true };
}

export async function updateDesk(id: string, formData: FormData) {
  const context = await getAdminContext();
  const currentDesk = await getDeskById(context, id);
  const officeId = formData.get('office_id') as string;
  const departmentId = formData.get('department_id') as string;
  await getOfficeById(context, officeId);
  await assertDepartmentInOffice(context, departmentId, officeId);
  await assertStaffAssignment(
    context,
    (formData.get('current_staff_id') as string) || null,
    officeId
  );

  const { data: desk, error } = await context.supabase
    .from('desks')
    .update({
      name: formData.get('name') as string,
      display_name: (formData.get('display_name') as string) || null,
      office_id: officeId,
      department_id: departmentId,
      current_staff_id: (formData.get('current_staff_id') as string) || null,
      status: (formData.get('status') as string) || 'closed',
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id)
    .select('id, name, office_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'desk_updated',
    entityType: 'desk',
    entityId: desk.id,
    officeId: desk.office_id,
    summary: `Updated desk ${desk.name}`,
    metadata: {
      previousOfficeId: currentDesk.office_id,
      nextOfficeId: officeId,
      previousDepartmentId: currentDesk.department_id,
      nextDepartmentId: departmentId,
    },
  });

  revalidatePath('/admin/desks');
  return { success: true };
}

export async function deleteDesk(id: string) {
  const context = await getAdminContext();
  const desk = await getDeskById(context, id);

  const { error } = await context.supabase.from('desks').delete().eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'desk_deleted',
    entityType: 'desk',
    entityId: id,
    officeId: desk.office_id,
    summary: `Deleted desk ${id}`,
    metadata: {},
  });

  revalidatePath('/admin/desks');
  return { success: true };
}

/**
 * Assign a staff member to a desk, or unassign (pass deskId = null).
 * - Frees any desk the staff currently occupies (one-staff-per-desk invariant).
 * - Rejects inactive staff, inactive desks, or desks in closed offices.
 * - If the desk is in a different office than the staff, returns
 *   { error: 'CROSS_OFFICE', crossOffice: true, targetOfficeId } unless
 *   allowOfficeChange is true — in which case it also updates staff.office_id.
 */
export async function assignStaffToDesk(input: {
  staffId: string;
  deskId: string | null;
  allowOfficeChange?: boolean;
}): Promise<{ success?: true; error?: string; crossOffice?: boolean; targetOfficeId?: string }> {
  const context = await getAdminContext();

  // Load staff and validate org membership
  const { data: staff } = await context.supabase
    .from('staff')
    .select('id, full_name, organization_id, office_id, is_active, role')
    .eq('id', input.staffId)
    .maybeSingle();

  if (!staff || staff.organization_id !== context.staff.organization_id) {
    return { error: 'Team member not found in your organization.' };
  }

  if (!staff.is_active) {
    return { error: 'This team member is inactive. Reactivate them before assigning a desk.' };
  }

  // Unassign: just free whatever desk they hold and return
  if (!input.deskId) {
    const { data: priorDesks } = await context.supabase
      .from('desks')
      .select('id, name, office_id')
      .eq('current_staff_id', input.staffId);

    if (priorDesks && priorDesks.length > 0) {
      const { error } = await context.supabase
        .from('desks')
        .update({ current_staff_id: null })
        .eq('current_staff_id', input.staffId);
      if (error) return { error: error.message };

      for (const prior of priorDesks) {
        await logAuditEvent(context, {
          actionType: 'desk_staff_unassigned',
          entityType: 'desk',
          entityId: prior.id,
          officeId: prior.office_id,
          summary: `Unassigned ${staff.full_name} from desk ${prior.name}`,
          metadata: { staffId: staff.id },
        });
      }
    }

    revalidatePath('/admin/desks');
    revalidatePath('/admin/staff');
    return { success: true };
  }

  // Load target desk with office active status
  const { data: desk } = await context.supabase
    .from('desks')
    .select('id, name, is_active, office_id, current_staff_id, office:offices(id, is_active, organization_id)')
    .eq('id', input.deskId)
    .maybeSingle();

  const deskOffice = Array.isArray(desk?.office) ? desk?.office[0] : desk?.office;
  if (!desk || !deskOffice || deskOffice.organization_id !== context.staff.organization_id) {
    return { error: 'Desk not found in your organization.' };
  }

  await requireOfficeAccess(context, desk.office_id);

  if (desk.is_active === false) {
    return { error: 'This desk is inactive. Reactivate it before assigning someone.' };
  }
  if (deskOffice.is_active === false) {
    return { error: 'Cannot assign to a desk in a closed office.' };
  }

  // No-op: staff already on this desk
  if (desk.current_staff_id === input.staffId) {
    return { success: true };
  }

  // Cross-office guard — require explicit confirmation from the caller
  const crossOffice = !!staff.office_id && staff.office_id !== desk.office_id;
  if (crossOffice && !input.allowOfficeChange) {
    return { error: 'CROSS_OFFICE', crossOffice: true, targetOfficeId: desk.office_id };
  }

  // Free any desk this staff currently holds (invariant: 1 desk per staff)
  await context.supabase
    .from('desks')
    .update({ current_staff_id: null })
    .eq('current_staff_id', input.staffId);

  // Free the target desk if someone else is on it
  if (desk.current_staff_id && desk.current_staff_id !== input.staffId) {
    await context.supabase
      .from('desks')
      .update({ current_staff_id: null })
      .eq('id', desk.id);
  }

  // Assign
  const { error: assignErr } = await context.supabase
    .from('desks')
    .update({ current_staff_id: input.staffId })
    .eq('id', desk.id);
  if (assignErr) return { error: assignErr.message };

  // Move staff office if cross-office and confirmed
  if (crossOffice && input.allowOfficeChange) {
    await context.supabase
      .from('staff')
      .update({ office_id: desk.office_id })
      .eq('id', input.staffId);
  }

  await logAuditEvent(context, {
    actionType: 'desk_staff_assigned',
    entityType: 'desk',
    entityId: desk.id,
    officeId: desk.office_id,
    summary: `Assigned ${staff.full_name} to desk ${desk.name}`,
    metadata: {
      staffId: staff.id,
      crossOffice,
      previousOfficeId: staff.office_id,
      previousOccupantId: desk.current_staff_id ?? null,
    },
  });

  revalidatePath('/admin/desks');
  revalidatePath('/admin/staff');
  return { success: true };
}

// ─── Staff ──────────────────────────────────────────────────────────────────

/**
 * Real-time availability check for a staff email within the current org.
 * Returns { available: boolean, valid: boolean }.
 * Called while the user types in the Add Team Member form.
 */
export async function checkStaffEmailAvailability(
  rawEmail: string
): Promise<{ available: boolean; valid: boolean }> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { available: false, valid: false };
  }
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const { data } = await context.supabase
    .from('staff')
    .select('id')
    .eq('organization_id', context.staff.organization_id)
    .ilike('email', email)
    .limit(1);
  return { available: !(data && data.length > 0), valid: true };
}

export async function createStaffMember(formData: FormData) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const adminSupabase = createAdminClient();

  const email = ((formData.get('email') as string) || '').trim().toLowerCase();
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;
  const role = formData.get('role') as string;
  const officeId = (formData.get('office_id') as string) || null;
  const departmentId = (formData.get('department_id') as string) || null;
  const sendSetupEmail = formData.get('send_setup_email') === 'true';

  if (!email) {
    return { error: 'Email is required.' };
  }

  const { data: existingStaff } = await context.supabase
    .from('staff')
    .select('id')
    .eq('organization_id', context.staff.organization_id)
    .ilike('email', email)
    .maybeSingle();

  if (existingStaff) {
    return { error: 'A team member with this email already exists in your business.' };
  }

  if (officeId) {
    await getOfficeById(context, officeId);
  }

  if (departmentId) {
    const department = await getDepartmentById(context, departmentId);
    if (officeId && department.office_id !== officeId) {
      throw new Error('Department must belong to the selected office');
    }
  }

  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      organization_id: context.staff.organization_id,
    },
  });

  if (authError) return { error: authError.message };
  if (!authData.user) return { error: 'Failed to create auth user' };

  const { data: staffMember, error: staffError } = await context.supabase
    .from('staff')
    .insert({
      auth_user_id: authData.user.id,
      email,
      full_name: fullName,
      role,
      office_id: officeId,
      department_id: departmentId,
      organization_id: context.staff.organization_id,
      is_active: formData.get('is_active') === 'true',
    })
    .select('id, full_name, office_id')
    .single();

  if (staffError) return { error: staffError.message };

  if (sendSetupEmail) {
    await adminSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl()}/login`,
    });
  }

  await logAuditEvent(context, {
    actionType: 'staff_created',
    entityType: 'staff',
    entityId: staffMember.id,
    officeId: staffMember.office_id,
    summary: `Created staff member ${staffMember.full_name}`,
    metadata: {
      email,
      role,
      officeId,
      departmentId,
      sendSetupEmail,
    },
  });

  revalidatePath('/admin/staff');
  revalidatePath('/admin/setup-wizard');
  return { success: true };
}

export async function updateStaffMember(id: string, formData: FormData) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const adminSupabase = createAdminClient();
  const currentStaff = await getStaffMember(context, id);
  const email = (formData.get('email') as string) || currentStaff.email;

  const officeId = (formData.get('office_id') as string) || null;
  const departmentId = (formData.get('department_id') as string) || null;

  if (officeId) {
    await getOfficeById(context, officeId);
  }

  if (departmentId) {
    const department = await getDepartmentById(context, departmentId);
    if (officeId && department.office_id !== officeId) {
      throw new Error('Department must belong to the selected office');
    }
  }

  if (email.toLowerCase() !== currentStaff.email.toLowerCase()) {
    const { data: duplicateStaff } = await context.supabase
      .from('staff')
      .select('id')
      .eq('organization_id', context.staff.organization_id)
      .ilike('email', email)
      .neq('id', id)
      .maybeSingle();

    if (duplicateStaff) {
      return { error: 'Another team member in this business already uses that email.' };
    }
  }

  if (currentStaff.auth_user_id) {
    const { error: authUpdateError } = await adminSupabase.auth.admin.updateUserById(
      currentStaff.auth_user_id,
      {
        email,
        user_metadata: {
          full_name: formData.get('full_name') as string,
          organization_id: context.staff.organization_id,
        },
      }
    );

    if (authUpdateError) {
      return { error: authUpdateError.message };
    }
  }

  const { data: staffMember, error } = await context.supabase
    .from('staff')
    .update({
      full_name: formData.get('full_name') as string,
      email,
      role: formData.get('role') as string,
      office_id: officeId,
      department_id: departmentId,
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id)
    .select('id, full_name, office_id')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'staff_updated',
    entityType: 'staff',
    entityId: staffMember.id,
    officeId: staffMember.office_id,
    summary: `Updated staff member ${staffMember.full_name}`,
    metadata: {
      previousOfficeId: currentStaff.office_id,
      nextOfficeId: officeId,
      previousDepartmentId: currentStaff.department_id,
      nextDepartmentId: departmentId,
      email,
      previousRole: currentStaff.role,
      nextRole: formData.get('role') as string,
    },
  });

  revalidatePath('/admin/staff');
  return { success: true };
}

export async function sendStaffPasswordReset(id: string) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const adminSupabase = createAdminClient();
  const staffMember = await getStaffMember(context, id);

  const { error } = await adminSupabase.auth.resetPasswordForEmail(staffMember.email, {
    redirectTo: `${appUrl()}/login`,
  });

  if (error) {
    return { error: error.message };
  }

  await logAuditEvent(context, {
    actionType: 'staff_updated',
    entityType: 'staff',
    entityId: staffMember.id,
    officeId: staffMember.office_id,
    summary: `Sent password reset email to ${staffMember.full_name}`,
    metadata: {
      email: staffMember.email,
      role: staffMember.role,
      action: 'password_reset_sent',
    },
  });

  revalidatePath('/admin/staff');
  return { success: true };
}

// ─── Priority Categories ────────────────────────────────────────────────────

export async function createPriorityCategory(formData: FormData) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);

  const { data: priority, error } = await context.supabase
    .from('priority_categories')
    .insert({
      name: formData.get('name') as string,
      icon: (formData.get('icon') as string) || null,
      color: (formData.get('color') as string) || '#6b7280',
      weight: formData.get('weight') ? Number(formData.get('weight')) : 1,
      is_active: formData.get('is_active') === 'true',
      organization_id: context.staff.organization_id,
    })
    .select('id, name')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'priority_created',
    entityType: 'priority_category',
    entityId: priority.id,
    summary: `Created priority category ${priority.name}`,
    metadata: {
      color: formData.get('color'),
      weight: formData.get('weight'),
    },
  });

  revalidatePath('/admin/priorities');
  return { success: true };
}

export async function updatePriorityCategory(id: string, formData: FormData) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  const priority = await getPriorityCategory(context, id);

  const { data: updatedPriority, error } = await context.supabase
    .from('priority_categories')
    .update({
      name: formData.get('name') as string,
      icon: (formData.get('icon') as string) || null,
      color: (formData.get('color') as string) || '#6b7280',
      weight: formData.get('weight') ? Number(formData.get('weight')) : 1,
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id)
    .select('id, name')
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'priority_updated',
    entityType: 'priority_category',
    entityId: updatedPriority.id,
    summary: `Updated priority category ${updatedPriority.name}`,
    metadata: {
      previousName: priority.name,
      nextName: updatedPriority.name,
      weight: formData.get('weight'),
    },
  });

  revalidatePath('/admin/priorities');
  return { success: true };
}

export async function deletePriorityCategory(id: string) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);
  await getPriorityCategory(context, id);

  const { error } = await context.supabase
    .from('priority_categories')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'priority_deleted',
    entityType: 'priority_category',
    entityId: id,
    summary: `Deleted priority category ${id}`,
    metadata: {},
  });

  revalidatePath('/admin/priorities');
  return { success: true };
}

// ─── Kiosk Settings ─────────────────────────────────────────────────────────

export async function updateKioskSettings(settings: Record<string, any>) {
  const context = await getAdminContext();
  await requireOrganizationAdmin(context);

  const { data: organization } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', context.staff.organization_id)
    .single();

  const currentSettings = (organization?.settings as Record<string, any>) ?? {};
  const mergedSettings = { ...currentSettings, ...settings };

  const { error } = await context.supabase
    .from('organizations')
    .update({ settings: mergedSettings })
    .eq('id', context.staff.organization_id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'organization_kiosk_settings_updated',
    entityType: 'organization',
    entityId: context.staff.organization_id,
    summary: 'Updated kiosk settings',
    metadata: settings,
  });

  revalidatePath('/admin/kiosk');
  revalidatePath('/admin/settings');
  revalidatePath('/kiosk/[officeSlug]', 'page');
  revalidatePath('/sandbox/[token]/kiosk', 'page');
  return { success: true };
}

// ─── Display Screens ────────────────────────────────────────────────────────

export async function createDisplayScreen(officeId: string, name: string) {
  const context = await getAdminContext();
  await requireOfficeAccess(context, officeId);

  const { data: office } = await context.supabase
    .from('offices')
    .select('settings, organization:organizations(settings)')
    .eq('id', officeId)
    .maybeSingle();

  const platformConfig = resolvePlatformConfig({
    organizationSettings:
      ((office?.organization as { settings?: Record<string, unknown> | null } | null)?.settings as Record<string, unknown> | null) ?? {},
    officeSettings: (office?.settings as Record<string, unknown> | null) ?? {},
  });

  // Use office token for the first display screen (unified with kiosk URL),
  // fall back to random token if that office token is already taken (additional screens)
  const officeToken = officeId.replace(/-/g, '').slice(0, 16);
  const { data: existingScreen } = await context.supabase
    .from('display_screens')
    .select('id')
    .eq('screen_token', officeToken)
    .maybeSingle();
  const screenToken = existingScreen ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : officeToken;

  const { data, error } = await context.supabase
    .from('display_screens')
    .insert({
      office_id: officeId,
      name,
      screen_token: screenToken,
      layout: platformConfig.experienceProfile.display.defaultLayout,
      is_active: true,
      settings: {
        theme: 'light',
        bg_color: '#f8fafc',
        accent_color: '#2563eb',
        show_clock: platformConfig.experienceProfile.display.showClock,
        show_next_up: platformConfig.experienceProfile.display.showNextUp,
        show_department_breakdown:
          platformConfig.experienceProfile.display.showDepartmentBreakdown,
        announcement_sound: platformConfig.experienceProfile.display.announcementSound,
      },
    })
    .select()
    .single();

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'display_created',
    entityType: 'display_screen',
    entityId: data.id,
    officeId,
    summary: `Created display screen ${name}`,
    metadata: {
      layout: data.layout,
      screenToken: data.screen_token,
    },
  });

  revalidatePath('/admin/displays');
  return { data };
}

export async function updateDisplayScreen(
  screenId: string,
  updates: {
    name?: string;
    layout?: string;
    is_active?: boolean;
    settings?: Record<string, any>;
  }
) {
  const context = await getAdminContext();
  const display = await getDisplayById(context, screenId);

  const { error } = await context.supabase
    .from('display_screens')
    .update(updates)
    .eq('id', screenId);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'display_updated',
    entityType: 'display_screen',
    entityId: screenId,
    officeId: display.office_id,
    summary: `Updated display screen ${screenId}`,
    metadata: updates,
  });

  revalidatePath('/admin/displays');
  return { success: true };
}

export async function deleteDisplayScreen(screenId: string) {
  const context = await getAdminContext();
  const display = await getDisplayById(context, screenId);

  const { error } = await context.supabase
    .from('display_screens')
    .delete()
    .eq('id', screenId);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'display_deleted',
    entityType: 'display_screen',
    entityId: screenId,
    officeId: display.office_id,
    summary: `Deleted display screen ${screenId}`,
    metadata: {},
  });

  revalidatePath('/admin/displays');
  return { success: true };
}
