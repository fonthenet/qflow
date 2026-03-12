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

  return { supabase, orgId: staff.organization_id };
}

// ─── Update Organization Settings ──────────────────────────────────────────

export async function updateOrganizationSettings(data: {
  orgId: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: Record<string, any>;
}) {
  const { supabase, orgId } = await getOrgId();

  // Ensure the user can only update their own org
  if (data.orgId !== orgId) {
    return { error: 'Unauthorized: organization mismatch' };
  }

  const { error } = await supabase
    .from('organizations')
    .update({
      name: data.name,
      slug: data.slug,
      logo_url: data.logo_url,
      settings: data.settings,
    })
    .eq('id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/admin/settings');
  return { success: true };
}
