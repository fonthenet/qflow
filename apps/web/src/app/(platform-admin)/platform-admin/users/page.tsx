import { createClient } from '@/lib/supabase/server';
import { UsersClient } from './users-client';

export default async function UsersPage() {
  const supabase = await createClient();

  // Get all staff with their organizations
  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, email, role, is_active, created_at, organization:organizations(id, name, slug)')
    .order('created_at', { ascending: false });

  return <UsersClient staff={(staff || []).map((s: Record<string, unknown>) => ({
    ...s,
    organization: Array.isArray(s.organization) ? s.organization[0] || null : s.organization,
  })) as any} />;
}
