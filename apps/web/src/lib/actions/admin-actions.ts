'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ─── Helper: get org_id from authenticated user ────────────────────────────

async function getOrgId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Not authenticated');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) throw new Error('Staff profile not found');

  return { supabase, orgId: staff.organization_id, userId: user.id };
}

// ─── Offices ────────────────────────────────────────────────────────────────

export async function createOffice(formData: FormData) {
  const { supabase, orgId } = await getOrgId();

  const { error } = await supabase.from('offices').insert({
    name: formData.get('name') as string,
    address: (formData.get('address') as string) || null,
    timezone: (formData.get('timezone') as string) || null,
    is_active: formData.get('is_active') === 'true',
    organization_id: orgId,
  });

  if (error) return { error: error.message };
  revalidatePath('/admin/offices');
  return { success: true };
}

export async function updateOffice(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('offices')
    .update({
      name: formData.get('name') as string,
      address: (formData.get('address') as string) || null,
      timezone: (formData.get('timezone') as string) || null,
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/offices');
  return { success: true };
}

export async function deleteOffice(id: string) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('offices').delete().eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/offices');
  return { success: true };
}

// ─── Departments ────────────────────────────────────────────────────────────

export async function createDepartment(formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('departments').insert({
    name: formData.get('name') as string,
    code: formData.get('code') as string,
    description: (formData.get('description') as string) || null,
    office_id: formData.get('office_id') as string,
    is_active: formData.get('is_active') === 'true',
    sort_order: formData.get('sort_order')
      ? Number(formData.get('sort_order'))
      : null,
  });

  if (error) return { error: error.message };
  revalidatePath('/admin/departments');
  return { success: true };
}

export async function updateDepartment(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('departments')
    .update({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      office_id: formData.get('office_id') as string,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order')
        ? Number(formData.get('sort_order'))
        : null,
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/departments');
  return { success: true };
}

export async function deleteDepartment(id: string) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('departments')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/departments');
  return { success: true };
}

// ─── Services ───────────────────────────────────────────────────────────────

export async function createService(formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('services').insert({
    name: formData.get('name') as string,
    code: formData.get('code') as string,
    description: (formData.get('description') as string) || null,
    department_id: formData.get('department_id') as string,
    estimated_service_time: formData.get('estimated_service_time')
      ? Number(formData.get('estimated_service_time'))
      : null,
    priority: formData.get('priority') ? Number(formData.get('priority')) : null,
    is_active: formData.get('is_active') === 'true',
    sort_order: formData.get('sort_order')
      ? Number(formData.get('sort_order'))
      : null,
  });

  if (error) return { error: error.message };
  revalidatePath('/admin/services');
  return { success: true };
}

export async function updateService(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('services')
    .update({
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      description: (formData.get('description') as string) || null,
      department_id: formData.get('department_id') as string,
      estimated_service_time: formData.get('estimated_service_time')
        ? Number(formData.get('estimated_service_time'))
        : null,
      priority: formData.get('priority')
        ? Number(formData.get('priority'))
        : null,
      is_active: formData.get('is_active') === 'true',
      sort_order: formData.get('sort_order')
        ? Number(formData.get('sort_order'))
        : null,
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/services');
  return { success: true };
}

export async function deleteService(id: string) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('services').delete().eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/services');
  return { success: true };
}

// ─── Desks ──────────────────────────────────────────────────────────────────

export async function createDesk(formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('desks').insert({
    name: formData.get('name') as string,
    display_name: (formData.get('display_name') as string) || null,
    office_id: formData.get('office_id') as string,
    department_id: formData.get('department_id') as string,
    current_staff_id: (formData.get('current_staff_id') as string) || null,
    status: (formData.get('status') as string) || 'closed',
    is_active: formData.get('is_active') === 'true',
  });

  if (error) return { error: error.message };
  revalidatePath('/admin/desks');
  return { success: true };
}

export async function updateDesk(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('desks')
    .update({
      name: formData.get('name') as string,
      display_name: (formData.get('display_name') as string) || null,
      office_id: formData.get('office_id') as string,
      department_id: formData.get('department_id') as string,
      current_staff_id: (formData.get('current_staff_id') as string) || null,
      status: (formData.get('status') as string) || 'closed',
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/desks');
  return { success: true };
}

export async function deleteDesk(id: string) {
  const { supabase } = await getOrgId();

  const { error } = await supabase.from('desks').delete().eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/desks');
  return { success: true };
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function createStaffMember(formData: FormData) {
  const { supabase, orgId } = await getOrgId();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;
  const role = formData.get('role') as string;
  const officeId = (formData.get('office_id') as string) || null;
  const departmentId = (formData.get('department_id') as string) || null;

  // Create auth user via Supabase admin API (invites user)
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (authError) return { error: authError.message };
  if (!authData.user) return { error: 'Failed to create auth user' };

  // Create staff record
  const { error: staffError } = await supabase.from('staff').insert({
    auth_user_id: authData.user.id,
    email,
    full_name: fullName,
    role,
    office_id: officeId,
    department_id: departmentId,
    organization_id: orgId,
    is_active: formData.get('is_active') === 'true',
  });

  if (staffError) return { error: staffError.message };
  revalidatePath('/admin/staff');
  return { success: true };
}

// ─── Priority Categories ────────────────────────────────────────────────────

export async function createPriorityCategory(formData: FormData) {
  const { supabase, orgId } = await getOrgId();

  const { error } = await supabase.from('priority_categories').insert({
    name: formData.get('name') as string,
    icon: (formData.get('icon') as string) || null,
    color: (formData.get('color') as string) || '#6b7280',
    weight: formData.get('weight') ? Number(formData.get('weight')) : 1,
    is_active: formData.get('is_active') === 'true',
    organization_id: orgId,
  });

  if (error) return { error: error.message };
  revalidatePath('/admin/priorities');
  return { success: true };
}

export async function updatePriorityCategory(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('priority_categories')
    .update({
      name: formData.get('name') as string,
      icon: (formData.get('icon') as string) || null,
      color: (formData.get('color') as string) || '#6b7280',
      weight: formData.get('weight') ? Number(formData.get('weight')) : 1,
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/priorities');
  return { success: true };
}

export async function deletePriorityCategory(id: string) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('priority_categories')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/priorities');
  return { success: true };
}

export async function updateStaffMember(id: string, formData: FormData) {
  const { supabase } = await getOrgId();

  const { error } = await supabase
    .from('staff')
    .update({
      full_name: formData.get('full_name') as string,
      email: formData.get('email') as string,
      role: formData.get('role') as string,
      office_id: (formData.get('office_id') as string) || null,
      department_id: (formData.get('department_id') as string) || null,
      is_active: formData.get('is_active') === 'true',
    })
    .eq('id', id);

  if (error) return { error: error.message };
  revalidatePath('/admin/staff');
  return { success: true };
}
