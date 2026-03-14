'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

async function getAdminOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff || staff.role !== 'admin') throw new Error('Not authorized');
  return { supabase, orgId: staff.organization_id };
}

export async function createWebhookEndpoint(url: string, events: string[]) {
  const { supabase, orgId } = await getAdminOrg();

  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const { error } = await supabase.from('webhook_endpoints').insert({
    organization_id: orgId,
    url,
    secret,
    events,
  });

  if (error) return { error: error.message };

  revalidatePath('/admin/settings/webhooks');
  return { secret };
}

export async function updateWebhookEndpoint(id: string, data: { url?: string; events?: string[]; is_active?: boolean }) {
  const { supabase, orgId } = await getAdminOrg();

  const { error } = await supabase
    .from('webhook_endpoints')
    .update(data)
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/admin/settings/webhooks');
  return { success: true };
}

export async function deleteWebhookEndpoint(id: string) {
  const { supabase, orgId } = await getAdminOrg();

  const { error } = await supabase
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/admin/settings/webhooks');
  return { success: true };
}
