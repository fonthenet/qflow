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

  // Get all active offices with their queue stats
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, address, timezone')
    .eq('organization_id', org.id)
    .eq('is_active', true);

  if (!offices) notFound();

  // For each office, get waiting ticket count
  const officeStats = await Promise.all(
    offices.map(async (office) => {
      const { count: waitingCount } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('office_id', office.id)
        .eq('status', 'waiting');

      const { count: servingCount } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('office_id', office.id)
        .in('status', ['called', 'serving']);

      // Get departments with their waiting counts
      const { data: departments } = await supabase
        .from('departments')
        .select('id, name, code')
        .eq('office_id', office.id)
        .eq('is_active', true);

      return {
        ...office,
        waitingCount: waitingCount || 0,
        servingCount: servingCount || 0,
        departments: departments || [],
      };
    })
  );

  return (
    <BranchComparison
      organization={org}
      offices={officeStats}
    />
  );
}
