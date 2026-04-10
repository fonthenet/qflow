import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { BookingForm } from '@/components/appointments/booking-form';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { resolvePlatformConfig } from '@/lib/platform/config';

interface BookingPageProps {
  params: Promise<{ officeSlug: string }>;
  searchParams?: Promise<{ departmentId?: string; serviceId?: string }>;
}

export default async function BookingPage({ params, searchParams }: BookingPageProps) {
  const { officeSlug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const supabase = createAdminClient();

  // Find office by slug (slugify office name and match)
  const { data: offices } = await supabase
    .from('offices')
    .select('*')
    .eq('is_active', true);

  const office = offices?.find((entry) => matchesOfficePublicSlug(entry, officeSlug));

  if (!office) notFound();

  // Check web booking is enabled at org level
  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', office.organization_id)
    .single();

  const _bookingOrgSettings = (organization?.settings ?? {}) as Record<string, any>;
  if (_bookingOrgSettings.web_enabled === false) notFound();

  // Get departments with services
  const { data: departments } = await supabase
    .from('departments')
    .select('*, services(*)')
    .eq('office_id', office.id)
    .eq('is_active', true)
    .order('sort_order');
  const platformConfig = resolvePlatformConfig({
    organizationSettings: organization?.settings ?? {},
    officeSettings: office.settings ?? {},
  });

  return (
    <BookingForm
      office={office}
      organization={organization}
      departments={departments || []}
      initialDepartmentId={resolvedSearchParams?.departmentId}
      initialServiceId={resolvedSearchParams?.serviceId}
      platformContext={{
        vertical: platformConfig.template.vertical,
        vocabulary: platformConfig.experienceProfile.vocabulary,
      }}
    />
  );
}
