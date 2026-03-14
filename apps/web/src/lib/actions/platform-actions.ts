'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const PLATFORM_ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const email = user.email?.toLowerCase() || '';
  if (!PLATFORM_ADMIN_EMAILS.includes(email)) {
    throw new Error('Not authorized as platform admin');
  }

  return { supabase, user };
}

// ── Organization actions ────────────────────────────────────────────

export async function updateOrgPlan(orgId: string, planId: string) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('organizations')
    .update({ plan_id: planId })
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/organizations');
  return { success: true };
}

export async function updateOrganization(orgId: string, data: {
  name?: string;
  slug?: string;
  plan_id?: string;
  subscription_status?: string;
  billing_period?: string;
  settings?: any;
}) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('organizations')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/organizations');
  revalidatePath(`/platform-admin/organizations/${orgId}`);
  return { success: true };
}

export async function deleteOrganization(orgId: string) {
  const { supabase } = await requirePlatformAdmin();

  // Delete in order: tickets, desks, services, departments, offices, staff, org
  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', orgId);

  const officeIds = offices?.map(o => o.id) || [];

  if (officeIds.length > 0) {
    await supabase.from('tickets').delete().in('office_id', officeIds);
    await supabase.from('appointments').delete().in('office_id', officeIds);
    await supabase.from('display_screens').delete().in('office_id', officeIds);

    const { data: depts } = await supabase
      .from('departments')
      .select('id')
      .in('office_id', officeIds);
    const deptIds = depts?.map(d => d.id) || [];

    if (deptIds.length > 0) {
      await supabase.from('services').delete().in('department_id', deptIds);
      await supabase.from('desks').delete().in('department_id', deptIds);
    }

    await supabase.from('departments').delete().in('office_id', officeIds);
    await supabase.from('offices').delete().eq('organization_id', orgId);
  }

  await supabase.from('staff').delete().eq('organization_id', orgId);
  await supabase.from('customers').delete().eq('organization_id', orgId);
  await supabase.from('priority_categories').delete().eq('organization_id', orgId);
  await supabase.from('api_keys').delete().eq('organization_id', orgId);
  await supabase.from('webhook_endpoints').delete().eq('organization_id', orgId);

  const { error } = await supabase
    .from('organizations')
    .delete()
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/organizations');
  return { success: true };
}

// ── User actions ────────────────────────────────────────────────────

export async function updateStaffRole(staffId: string, role: string) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('staff')
    .update({ role })
    .eq('id', staffId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/users');
  return { success: true };
}

export async function deleteStaffMember(staffId: string) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('staff')
    .delete()
    .eq('id', staffId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/users');
  return { success: true };
}

// ── Billing actions ─────────────────────────────────────────────────

export async function resetOrgVisitCount(orgId: string) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('organizations')
    .update({ monthly_visit_count: 0, visit_count_reset_at: new Date().toISOString() })
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/billing');
  revalidatePath('/platform-admin/organizations');
  return { success: true };
}

export async function overrideSubscription(orgId: string, data: {
  plan_id: string;
  subscription_status: string;
  billing_period: string;
}) {
  const { supabase } = await requirePlatformAdmin();

  const { error } = await supabase
    .from('organizations')
    .update(data)
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/platform-admin/billing');
  revalidatePath('/platform-admin/organizations');
  return { success: true };
}
