import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { KioskView } from '@/components/kiosk/kiosk-view';

interface KioskPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function KioskPage({ params }: KioskPageProps) {
  const { officeSlug } = await params;
  const supabase = await createClient();

  // Find office by slug (we use office name slugified)
  const { data: offices } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('is_active', true);

  const office = offices?.find(
    (o) =>
      o.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') === officeSlug
  );

  if (!office) notFound();

  // Get departments with services
  const { data: departments } = await supabase
    .from('departments')
    .select('*, services(*)')
    .eq('office_id', office.id)
    .eq('is_active', true)
    .order('sort_order');

  // Get active priority categories for this organization
  const { data: priorityCategories } = await supabase
    .from('priority_categories')
    .select('*')
    .eq('organization_id', office.organization_id)
    .eq('is_active', true)
    .order('weight', { ascending: false });

  return (
    <KioskView
      office={office}
      organization={office.organization}
      departments={departments || []}
      priorityCategories={priorityCategories || []}
    />
  );
}
