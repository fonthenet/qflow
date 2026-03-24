'use server';

import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '@/lib/audit';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';

export async function updateOrganizationSettings(data: {
  orgId: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: Record<string, any>;
}) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  if (data.orgId !== context.staff.organization_id) {
    return { error: 'Unauthorized: organization mismatch' };
  }

  const { data: organization, error: fetchError } = await context.supabase
    .from('organizations')
    .select('settings')
    .eq('id', context.staff.organization_id)
    .single();

  if (fetchError) return { error: fetchError.message };

  const currentSettings = (organization?.settings as Record<string, any>) ?? {};
  const mergedSettings = {
    ...currentSettings,
    ...data.settings,
  };

  const { error } = await context.supabase
    .from('organizations')
    .update({
      name: data.name,
      slug: data.slug,
      logo_url: data.logo_url,
      settings: mergedSettings,
    })
    .eq('id', context.staff.organization_id);

  if (error) return { error: error.message };

  if (typeof data.settings?.visit_intake_override_mode === 'string') {
    const { data: offices, error: officesError } = await context.supabase
      .from('offices')
      .select('id, settings')
      .eq('organization_id', context.staff.organization_id);

    if (officesError) return { error: officesError.message };

    for (const office of offices ?? []) {
      const officeSettings = (office.settings as Record<string, any> | null) ?? {};
      const { error: officeUpdateError } = await context.supabase
        .from('offices')
        .update({
          settings: {
            ...officeSettings,
            visit_intake_override_mode: data.settings.visit_intake_override_mode,
          },
        })
        .eq('id', office.id);

      if (officeUpdateError) {
        return { error: officeUpdateError.message };
      }
    }
  }

  await logAuditEvent(context, {
    actionType: 'organization_settings_updated',
    entityType: 'organization',
    entityId: context.staff.organization_id,
    summary: `Updated organization settings for ${data.name}`,
    metadata: {
      slug: data.slug,
      logoUrl: data.logo_url,
      updatedKeys: Object.keys(data.settings ?? {}),
    },
  });

  revalidatePath('/admin/settings');
  return { success: true };
}
