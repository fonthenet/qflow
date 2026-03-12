import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { BookingForm } from '@/components/appointments/booking-form';

interface BookingPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function BookingPage({ params }: BookingPageProps) {
  const { officeSlug } = await params;
  const supabase = await createClient();

  // Find office by slug (slugify office name and match)
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

  return (
    <BookingForm
      office={office}
      organization={office.organization}
      departments={departments || []}
    />
  );
}
