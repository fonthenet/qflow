import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { AppointmentCheckIn } from '@/components/appointments/appointment-checkin';
import { matchesOfficePublicSlug } from '@/lib/office-links';

interface CheckInPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function AppointmentCheckInPage({ params }: CheckInPageProps) {
  const { officeSlug } = await params;
  const supabase = createAdminClient();

  // Find office by slug
  const { data: offices } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('is_active', true);

  const office = offices?.find((entry) => matchesOfficePublicSlug(entry, officeSlug));

  if (!office) notFound();

  return (
    <AppointmentCheckIn
      office={office}
      organization={office.organization}
    />
  );
}
