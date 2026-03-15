import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { OrgDetailClient } from './org-detail-client';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OrgDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single();

  if (!org) notFound();

  // Get staff
  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, email, role, is_active, created_at')
    .eq('organization_id', id)
    .order('created_at');

  // Get offices with departments
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, address, is_active, timezone, created_at')
    .eq('organization_id', id)
    .order('created_at');

  // Get ticket stats
  const officeIds = offices?.map(o => o.id) || [];
  let ticketCount = 0;
  let todayTickets = 0;

  if (officeIds.length > 0) {
    const { count } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('office_id', officeIds);
    ticketCount = count || 0;

    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('office_id', officeIds)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`);
    todayTickets = todayCount || 0;
  }

  // Get customers count
  const { count: customerCount } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', id);

  return (
    <OrgDetailClient
      org={org}
      staff={staff || []}
      offices={offices || []}
      stats={{ ticketCount, todayTickets, customerCount: customerCount || 0 }}
    />
  );
}
