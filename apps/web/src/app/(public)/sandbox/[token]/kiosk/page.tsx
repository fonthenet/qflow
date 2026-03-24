import { notFound } from 'next/navigation';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import { KioskView } from '@/components/kiosk/kiosk-view';
import { getSandboxPreviewByToken, resetSandboxPreviewToStock } from '@/lib/platform/sandbox-preview';

interface SandboxKioskPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ reset?: string }>;
}

function toSandboxScheduledAt(timeLabel: string) {
  const [time, meridiem] = timeLabel.split(' ');
  const [hourString, minuteString] = time.split(':');
  let hour = Number(hourString);
  const minute = Number(minuteString);

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  return new Date(Date.UTC(2026, 2, 16, hour, minute, 0)).toISOString();
}

const supportedKioskVerticals = [
  'public_service',
  'bank',
  'clinic',
  'restaurant',
  'barbershop',
] as const;

type SupportedKioskVertical = (typeof supportedKioskVerticals)[number];

export default async function SandboxKioskPage({
  params,
  searchParams,
}: SandboxKioskPageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const basePreview = await getSandboxPreviewByToken(token);
  const preview =
    basePreview && resolvedSearchParams?.reset ? resetSandboxPreviewToStock(basePreview) : basePreview;

  if (!preview) {
    notFound();
  }

  const kioskVertical = supportedKioskVerticals.includes(
    preview.template.vertical as SupportedKioskVertical
  )
    ? (preview.template.vertical as SupportedKioskVertical)
    : undefined;

  return (
    <SandboxFrame
      preview={preview}
      title="Kiosk Preview"
      subtitle={`Walk through the self-service flow for ${preview.office.name} and scan a real sandbox QR code.`}
      resetHref={preview.links.kiosk}
    >
      <KioskView
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
          settings: {},
        }}
        departments={preview.departments.map((department) => ({
          id: department.id,
          code: department.code,
          name: department.name,
          is_active: true,
          services: department.services.map((service) => ({
            id: service.id,
            code: service.code,
            name: service.name,
            description: (service as { description?: string }).description ?? '',
            is_active: true,
            estimated_duration_minutes: (service as { estimatedServiceTime?: number }).estimatedServiceTime ?? 10,
          })),
        }))}
        priorityCategories={preview.priorities}
        kioskSettings={{
          welcomeMessage: preview.kioskProfile.welcomeMessage,
          headerText: preview.kioskProfile.headerText,
          themeColor: preview.kioskProfile.themeColor,
          logoUrl: preview.organization.logoUrl,
          showLogo: Boolean(preview.organization.logoUrl),
          vertical: kioskVertical,
          mode: preview.kioskProfile.mode,
          showPriorities: preview.queuePolicy.priorityMode !== 'none',
          showEstimatedTime: preview.kioskProfile.showEstimatedTime,
          hiddenDepartments: [],
          hiddenServices: [],
          lockedDepartmentId: null,
          buttonLabel: preview.kioskProfile.buttonLabel,
          idleTimeout: preview.kioskProfile.idleTimeoutSeconds,
          visitIntakeOverrideMode: 'business_hours',
        }}
        sandbox={{
          enabled: true,
          bookingPath: preview.links.booking,
          queuePreviewBasePath: `/sandbox/${preview.token}/queue`,
          appointments: preview.bookings
            .filter((booking) => booking.status !== 'cancelled')
            .map((booking) => ({
              id: booking.id,
              customer_name: booking.name,
              customer_phone: '5550101',
              department: { name: booking.departmentName },
              service: { name: booking.serviceName },
              scheduled_at: toSandboxScheduledAt(booking.timeLabel),
              status: booking.status,
            })),
        }}
      />
    </SandboxFrame>
  );
}
