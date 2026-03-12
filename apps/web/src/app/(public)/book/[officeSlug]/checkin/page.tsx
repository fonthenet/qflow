import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { AppointmentCheckIn } from '@/components/appointments/appointment-checkin';

interface CheckInPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function AppointmentCheckInPage({ params }: CheckInPageProps) {
  const { officeSlug } = await params;
  const supabase = await createClient();

  // Find office by slug
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

  return (
    <AppointmentCheckIn
      office={office}
      organization={office.organization}
    />
  );
}
