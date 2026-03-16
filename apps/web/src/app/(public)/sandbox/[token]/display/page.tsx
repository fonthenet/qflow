import { notFound } from 'next/navigation';
import { DisplayBoard } from '@/components/display/display-board';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import { getSandboxPreviewByToken, resetSandboxPreviewToStock } from '@/lib/platform/sandbox-preview';

interface SandboxDisplayPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ reset?: string }>;
}

export default async function SandboxDisplayPage({
  params,
  searchParams,
}: SandboxDisplayPageProps) {
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
      title="Display Preview"
      subtitle={`Review the public screen experience for ${preview.office.name} without needing live queue traffic.`}
      resetHref={preview.links.display}
    >
      <DisplayBoard
        screen={{
          id: preview.displays[0]?.id ?? 'sandbox-display',
          name: preview.displays[0]?.name ?? 'Sandbox Display',
          layout:
            preview.displays[0]?.layout ?? preview.displayProfile.defaultLayout ?? 'list',
          settings: {
            theme: 'light',
            show_clock: preview.displayProfile.showClock,
            show_next_up: preview.displayProfile.showNextUp,
            show_department_breakdown: preview.displayProfile.showDepartmentBreakdown,
            announcement_sound: preview.displayProfile.announcementSound,
            accent_color: '#2563eb',
          },
        }}
        office={{
          id: `${preview.organization.id}-sandbox-office`,
          name: preview.office.name,
          organization: {
            name: preview.organization.name,
            logo_url: preview.organization.logoUrl,
          },
        }}
        departments={preview.departments.map((department) => ({
          id: department.id,
          name: department.name,
          code: department.code,
        }))}
        initialActiveTickets={preview.queueTickets
          .filter((ticket) => ticket.status === 'called' || ticket.status === 'serving')
          .map((ticket) => ({
            id: ticket.id,
            ticket_number: ticket.ticketNumber,
            status: ticket.status,
            called_at: new Date().toISOString(),
            service_started_at: ticket.status === 'serving' ? new Date().toISOString() : null,
            desk: {
              name: ticket.deskName ?? preview.desks[0]?.name ?? preview.vocabulary.deskLabel,
              display_name:
                ticket.deskName ??
                preview.desks[0]?.displayName ??
                preview.desks[0]?.name ??
                preview.vocabulary.deskLabel,
            },
            service: {
              name: ticket.serviceName,
            },
          }))}
        initialWaitingTickets={preview.queueTickets
          .filter((ticket) => ticket.status === 'waiting')
          .map((ticket) => ({
            id: ticket.id,
            department_id:
              preview.departments.find((department) => department.code === ticket.departmentCode)?.id ??
              ticket.departmentCode,
            ticket_number: ticket.ticketNumber,
            created_at: new Date().toISOString(),
          }))}
        calledTicketCountdownSeconds={60}
        sandboxMode
      />
    </SandboxFrame>
  );
}
