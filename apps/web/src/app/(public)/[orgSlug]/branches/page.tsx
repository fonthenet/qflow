import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { BranchComparison } from '@/components/queue/branch-comparison';

interface BranchesPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function BranchesPage({ params }: BranchesPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Find organization by slug
  const { data: org } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', orgSlug)
    .single();

  if (!org) notFound();

  // Get all active offices with departments in a single query
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, address, timezone, departments(id, name, code)')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .eq('departments.is_active', true);

  if (!offices) notFound();

  const officeIds = offices.map((o) => o.id);

  // Single aggregation query: count tickets per office per status group
  const { data: ticketCounts } = await supabase
    .from('tickets')
    .select('office_id, status')
    .in('office_id', officeIds)
    .in('status', ['waiting', 'called', 'serving']);

  // Build a lookup: { officeId: { waiting: N, serving: N } }
  const statsMap: Record<string, { waiting: number; serving: number }> = {};
  for (const row of ticketCounts ?? []) {
    if (!statsMap[row.office_id]) statsMap[row.office_id] = { waiting: 0, serving: 0 };
    if (row.status === 'waiting') {
      statsMap[row.office_id].waiting++;
    } else {
      // 'called' and 'serving' both count as serving
      statsMap[row.office_id].serving++;
    }
  }

  const officeStats = offices.map((office) => ({
    ...office,
    waitingCount: statsMap[office.id]?.waiting ?? 0,
    servingCount: statsMap[office.id]?.serving ?? 0,
    departments: office.departments ?? [],
  }));

  return (
    <BranchComparison
      organization={org}
      offices={officeStats}
    />
  );
}
