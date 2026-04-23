'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';

/**
 * Updates the DPO contact email stored in organizations.settings.dpo_contact_email.
 * No migration needed — organizations.settings is jsonb, new keys are additive.
 */
export async function updateDpoContact(orgId: string, dpoEmail: string): Promise<{ error?: string }> {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  if (orgId !== context.staff.organization_id) {
    return { error: 'Unauthorized: organization mismatch' };
  }

  const trimmed = dpoEmail.trim();
  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { error: 'Invalid email address' };
  }

  const { data: org, error: fetchError } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', orgId)
    .single();

  if (fetchError) return { error: fetchError.message };

  const currentSettings = (org?.settings as Record<string, unknown>) ?? {};
  const updatedSettings = {
    ...currentSettings,
    dpo_contact_email: trimmed || null,
  };

  const { error: updateError } = await context.supabase
    .from('organizations')
    .update({ settings: updatedSettings })
    .eq('id', orgId);

  if (updateError) return { error: updateError.message };

  revalidatePath('/admin/settings/privacy');
  return {};
}
