import { createClient } from '@/lib/supabase/server';
import { WebhooksClient } from './webhooks-client';

export default async function WebhooksPage() {
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
    return <div className="p-6 text-red-500">Only admins can manage webhooks.</div>;
  }

  const { data: endpoints } = await supabase
    .from('webhook_endpoints')
    .select('id, url, events, is_active, failure_count, last_triggered_at, created_at')
    .eq('organization_id', staff.organization_id)
    .order('created_at', { ascending: false });

  return <WebhooksClient endpoints={endpoints || []} />;
}
