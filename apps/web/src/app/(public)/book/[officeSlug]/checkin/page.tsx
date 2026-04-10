import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { AppointmentCheckIn } from '@/components/appointments/appointment-checkin';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { ServiceUnavailable } from '@/components/service-unavailable';

interface CheckInPageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function AppointmentCheckInPage({ params }: CheckInPageProps) {
  const { officeSlug } = await params;

  try {
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
  } catch (error) {
    console.error('[checkin-page] Database error:', error);
    return (
      <ServiceUnavailable
        title="Check-in temporarily unavailable"
        message="We're unable to load the check-in page right now. Please try again in a few minutes or check in at the front desk."
      />
    );
  }
}
