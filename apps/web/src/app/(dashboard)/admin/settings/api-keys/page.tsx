import { createClient } from '@/lib/supabase/server';
import { ApiKeysClient } from './api-keys-client';

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <div className="p-6 text-red-500">Not authenticated.</div>;
  }

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff || staff.role !== 'admin') {
    return <div className="p-6 text-red-500">Only admins can manage API keys.</div>;
  }

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, is_active, last_used_at, created_at')
    .eq('organization_id', staff.organization_id)
    .order('created_at', { ascending: false });

  return <ApiKeysClient keys={keys || []} />;
}
