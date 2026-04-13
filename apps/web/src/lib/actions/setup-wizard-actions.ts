'use server';

import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '@/lib/audit';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';

/**
 * Mark the business setup wizard as completed.
 * Stores `business_setup_wizard_completed_at` in organization settings.
 */
export async function completeBusinessSetupWizard() {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const { data: org, error: fetchError } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', context.staff.organization_id)
    .single();

  if (fetchError) return { error: fetchError.message };

  const currentSettings = (org?.settings as Record<string, any>) ?? {};

  const { error } = await context.supabase
    .from('organizations')
    .update({
      settings: {
        ...currentSettings,
        business_setup_wizard_completed_at: new Date().toISOString(),
      },
    })
    .eq('id', context.staff.organization_id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'business_setup_wizard_completed',
    entityType: 'organization',
    entityId: context.staff.organization_id,
    summary: 'Completed the business setup wizard',
    metadata: {},
  });

  revalidatePath('/admin');
  return { success: true };
}

/**
 * Update desk_services for a given desk.
 * Replaces all existing associations with the provided service IDs.
 */
export async function updateDeskServices(deskId: string, serviceIds: string[]) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const { error: deleteError } = await context.supabase
    .from('desk_services')
    .delete()
    .eq('desk_id', deskId);

  if (deleteError) return { error: deleteError.message };

  if (serviceIds.length > 0) {
    const { error: insertError } = await context.supabase
      .from('desk_services')
      .insert(serviceIds.map((serviceId) => ({ desk_id: deskId, service_id: serviceId })));

    if (insertError) return { error: insertError.message };
  }

  revalidatePath('/admin/desks');
  revalidatePath('/admin/setup-wizard');
  return { success: true };
}

/**
 * Assign an existing staff member to a desk (set current_staff_id).
 */
export async function assignStaffToDesk(deskId: string, staffId: string) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const { error } = await context.supabase
    .from('desks')
    .update({ current_staff_id: staffId })
    .eq('id', deskId);

  if (error) return { error: error.message };

  revalidatePath('/admin/setup-wizard');
  return { success: true };
}
