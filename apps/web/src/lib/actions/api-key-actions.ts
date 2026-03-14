'use server';

import { createClient } from '@/lib/supabase/server';
import { generateApiKey, hashApiKey } from '@/lib/api-auth';
import { revalidatePath } from 'next/cache';

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

export async function createApiKey(name: string) {
  const { supabase, orgId } = await getAdminOrg();

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 10);

  const { error } = await supabase.from('api_keys').insert({
    organization_id: orgId,
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });

  if (error) return { error: error.message };

  revalidatePath('/admin/settings');
  // Return the raw key only once — it cannot be retrieved later
  return { key: rawKey };
}

export async function listApiKeys() {
  const { supabase, orgId } = await getAdminOrg();

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, is_active, last_used_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { data };
}

export async function revokeApiKey(keyId: string) {
  const { supabase, orgId } = await getAdminOrg();

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/admin/settings');
  return { success: true };
}

export async function deleteApiKey(keyId: string) {
  const { supabase, orgId } = await getAdminOrg();

  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', keyId)
    .eq('organization_id', orgId);

  if (error) return { error: error.message };

  revalidatePath('/admin/settings');
  return { success: true };
}
