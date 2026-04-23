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

  // Guard: WhatsApp code + Arabic code must be unique across organizations.
  // Mirrors the portal availability check — belt-and-braces in case the client
  // debounced check didn't catch a late-write collision.
  const incomingWaCode = typeof data.settings?.whatsapp_code === 'string'
    ? data.settings.whatsapp_code.toUpperCase().trim()
    : '';
  const incomingArCode = typeof data.settings?.arabic_code === 'string'
    ? data.settings.arabic_code.trim()
    : '';
  if (incomingWaCode || incomingArCode) {
    const { data: otherOrgs } = await context.supabase
      .from('organizations')
      .select('id, settings')
      .neq('id', context.staff.organization_id);
    for (const org of otherOrgs ?? []) {
      const s = ((org as any).settings ?? {}) as Record<string, any>;
      const otherWa = (s.whatsapp_code ?? '').toString().toUpperCase().trim();
      const otherAr = (s.arabic_code ?? '').toString().trim();
      if (incomingWaCode && (incomingWaCode === otherWa || incomingWaCode === otherAr.toUpperCase())) {
        return { error: `Business code "${incomingWaCode}" is already taken by another organization.` };
      }
      if (incomingArCode && (incomingArCode === otherAr || incomingArCode.toUpperCase() === otherWa)) {
        return { error: `Arabic code "${incomingArCode}" is already taken by another organization.` };
      }
    }
  }

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

/**
 * Update the organization's country, vertical, primary locale, and timezone.
 * These are the profile fields managed by the Organization Profile settings page.
 */
export async function updateOrganizationProfile(data: {
  country?: string | null;
  vertical?: string | null;
  locale_primary?: string | null;
  timezone?: string | null;
}): Promise<{ success?: boolean; error?: string }> {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const { error } = await context.supabase
    .from('organizations')
    .update({
      country: data.country,
      vertical: data.vertical,
      locale_primary: data.locale_primary,
      timezone: data.timezone,
    })
    .eq('id', context.staff.organization_id);

  if (error) return { error: error.message };

  await logAuditEvent(context, {
    actionType: 'organization_profile_updated',
    entityType: 'organization',
    entityId: context.staff.organization_id,
    summary: 'Updated organization profile (country/vertical/locale/timezone)',
    metadata: {
      country: data.country,
      vertical: data.vertical,
      locale_primary: data.locale_primary,
      timezone: data.timezone,
    },
  });

  revalidatePath('/admin/settings');
  return { success: true };
}

/**
 * Check if a WhatsApp business code is available (not used by another org).
 */
export async function checkWhatsAppCodeAvailability(code: string): Promise<{ available: boolean }> {
  const context = await getStaffContext();
  const normalized = code.toUpperCase().trim();
  if (!normalized || normalized.length < 2) return { available: false };

  const { data: orgs } = await context.supabase
    .from('organizations')
    .select('id, settings');

  const taken = (orgs ?? []).some((org: any) => {
    if (org.id === context.staff.organization_id) return false; // skip own org
    const settings = (org.settings ?? {}) as Record<string, any>;
    const orgCode = (settings.whatsapp_code ?? '').toString().toUpperCase().trim();
    if (orgCode === normalized) return true;
    // Also check arabic_code
    const arCode = (settings.arabic_code ?? '').toString().trim();
    if (arCode && arCode === code.trim()) return true;
    return false;
  });

  return { available: !taken };
}
