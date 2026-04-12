import { notFound } from 'next/navigation';
import { BookingForm } from '@/components/appointments/booking-form';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import { getSandboxPreviewByToken, resetSandboxPreviewToStock } from '@/lib/platform/sandbox-preview';

interface SandboxBookingPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ reset?: string }>;
}

export default async function SandboxBookingPage({
  params,
  searchParams,
}: SandboxBookingPageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const basePreview = await getSandboxPreviewByToken(token);
  const preview =
    basePreview && resolvedSearchParams?.reset ? resetSandboxPreviewToStock(basePreview) : basePreview;

  if (!preview) {
    notFound();
  }

  return (
    <SandboxFrame
      preview={preview}
      title="Booking Preview"
      subtitle={`Try the reservation flow for ${preview.office.name} without creating any real bookings.`}
      resetHref={preview.links.booking}
    >
      <BookingForm
        office={{
          id: `${preview.organization.id}-sandbox-office`,
          name: preview.office.name,
          timezone: preview.office.timezone,
          settings: {},
        }}
        organization={{
          id: preview.organization.id,
          name: preview.organization.name,
          logo_url: preview.organization.logoUrl,
          timezone: preview.office.timezone,
          settings: {
            booking_email_otp_enabled: false,
          },
        }}
        departments={preview.departments.map((department) => ({
          id: department.id,
          name: department.name,
          code: department.code,
          services: department.services.map((service) => ({
            id: service.id,
            name: service.name,
            description: (service as { description?: string }).description ?? `${service.name} in sandbox mode`,
            estimated_duration_minutes: (service as { estimatedServiceTime?: number }).estimatedServiceTime ?? 15,
            is_active: true,
          })),
        }))}
        platformContext={{
          vertical: preview.template.vertical,
          vocabulary: preview.vocabulary,
        }}
        sandbox={{
          enabled: true,
          trackPath: preview.links.queue,
          sampleSlots: preview.sampleSlots ?? ['09:00', '09:30', '10:00', '10:30', '11:15', '11:45'],
        }}
      />
    </SandboxFrame>
  );
}
