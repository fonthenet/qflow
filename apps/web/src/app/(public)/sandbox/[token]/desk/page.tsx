import { notFound } from 'next/navigation';
import { DeskPanel } from '@/components/desk/desk-panel';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import {
  getSandboxPreviewByToken,
  resetSandboxPreviewToStock,
  type SandboxPreviewData,
} from '@/lib/platform/sandbox-preview';

interface SandboxDeskPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ reset?: string }>;
}

function toSandboxTicket(
  preview: SandboxPreviewData,
  entry: SandboxPreviewData['queueTickets'][number],
  departmentId: string,
  serviceId: string,
  deskId: string | null
) {
  const now = new Date().toISOString();

  return {
    id: entry.id,
    appointment_id: entry.source === 'reservation' ? `${entry.id}-appointment` : null,
    called_at: entry.status === 'called' || entry.status === 'serving' ? now : null,
    called_by_staff_id: null,
    checked_in_at: now,
    completed_at: entry.status === 'served' ? now : null,
    created_at: now,
    customer_data: {
      name: entry.name,
      party_name: entry.name,
      email: `${entry.name.toLowerCase().replace(/\s+/g, '.')}@sandbox.example`,
      party_size: entry.partySize,
      seating_preference: entry.seatingPreference,
      reservation_reference: entry.reservationReference,
      accessibility_seating: entry.needs?.includes('Accessible seating') ?? false,
      high_chair: entry.needs?.includes('High chair') ?? false,
      next_table_code: entry.nextTableCode,
      next_table_label: entry.nextTableLabel,
    },
    customer_id: null,
    daily_sequence: 1,
    department_id: departmentId,
    desk_id: deskId,
    estimated_wait_minutes: entry.status === 'waiting' ? entry.estimatedWaitMinutes : 0,
    group_id: null,
    is_remote: entry.source === 'remote_join',
    notes: `Sandbox preview only · ${preview.scenario.name}`,
    office_id: `${preview.organization.id}-sandbox-office`,
    priority: null,
    priority_category_id: null,
    qr_token: `${entry.id}-qr`,
    recall_count: entry.status === 'called' ? 1 : 0,
    service_id: serviceId,
    serving_started_at: entry.status === 'serving' ? now : null,
    status: entry.status,
    ticket_number: entry.ticketNumber,
    transferred_from_ticket_id: null,
  };
}

export default async function SandboxDeskPage({ params, searchParams }: SandboxDeskPageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const basePreview = await getSandboxPreviewByToken(token);
  const preview =
    basePreview && resolvedSearchParams?.reset ? resetSandboxPreviewToStock(basePreview) : basePreview;

  if (!preview) {
    notFound();
  }

  const officeId = `${preview.organization.id}-sandbox-office`;
  const desk = preview.desks[0] ?? {
    id: 'sandbox-desk-1',
    name: `${preview.vocabulary.deskLabel} 1`,
    displayName: `${preview.vocabulary.deskLabel} 1`,
    departmentCode: preview.departments[0]?.code ?? 'A',
    status: 'open' as const,
  };

  const departments = preview.departments.map((department, index) => ({
    id: department.id,
    office_id: officeId,
    code: department.code,
    name: department.name,
    sort_order: index,
    is_active: true,
  }));

  const services = preview.departments.flatMap((department) =>
    department.services.map((service, index) => ({
      id: service.id,
      department_id: department.id,
      code: service.code,
      name: service.name,
      sort_order: index,
      is_active: true,
    }))
  );

  const waitingEntries = preview.queueTickets.filter((ticket) => ticket.status === 'waiting');
  const calledEntries = preview.queueTickets.filter((ticket) => ticket.status === 'called');
  const servingEntries = preview.queueTickets.filter((ticket) => ticket.status === 'serving');
  const currentEntry = servingEntries[0] ?? calledEntries[0] ?? null;

  const buildMappedTicket = (entry: (typeof preview.queueTickets)[number]) => {
    const departmentId =
      departments.find((department) => department.code === entry.departmentCode)?.id ??
      departments[0]?.id ??
      'sandbox-department-1';
    const serviceId =
      services.find((service) => service.code === entry.serviceCode)?.id ??
      services[0]?.id ??
      'sandbox-service-1';
    const deskId =
      entry.deskName
        ? preview.desks.find((candidate) => (candidate.displayName ?? candidate.name) === entry.deskName)?.id ?? desk.id
        : entry.status === 'called' || entry.status === 'serving'
          ? desk.id
          : null;

    return toSandboxTicket(preview, entry, departmentId, serviceId, deskId) as never;
  };

  const sandboxRestaurantTables = preview.tablePresets.map((table, index) => {
    const activeEntry = preview.queueTickets.find(
      (entry) =>
        entry.nextTableCode === table.code &&
        (entry.status === 'called' || entry.status === 'serving')
    );

    return {
      id: `sandbox-table-${index + 1}`,
      office_id: officeId,
      code: table.code,
      label: table.label,
      zone: table.zone ?? null,
      capacity: table.capacity ?? null,
      min_party_size: table.minPartySize ?? null,
      max_party_size: table.maxPartySize ?? null,
      reservable: table.reservable ?? true,
      status: activeEntry ? 'occupied' : 'available',
      current_ticket_id: activeEntry?.id ?? null,
      assigned_at: activeEntry ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  return (
    <SandboxFrame
      preview={preview}
      title="Desk Preview"
      subtitle={`Run the business-side queue for ${preview.office.name}, including ${preview.scenario.name.toLowerCase()} activity, without changing live data.`}
      resetHref={preview.links.desk}
    >
      <DeskPanel
        desk={{
          id: desk.id,
          name: desk.name,
          display_name: desk.displayName ?? null,
          department_id:
            departments.find((department) => department.code === desk.departmentCode)?.id ??
            departments[0]?.id ??
            'sandbox-department-1',
          office_id: officeId,
        }}
        staffName="Sandbox Operator"
        departments={departments as never}
        services={services as never}
        priorityCategories={preview.priorities}
        currentTicketFields={[]}
        customerDataScope="admin"
        initialCurrentTicket={currentEntry ? buildMappedTicket(currentEntry) : null}
        restaurantTables={sandboxRestaurantTables as never}
        platformContext={{
          vertical: preview.template.vertical as never,
          vocabulary: preview.vocabulary,
          officeSettings: preview.officeSettings,
        }}
        sandbox={{
          enabled: true,
          initialQueue: {
            waiting: waitingEntries.map(buildMappedTicket),
            called: calledEntries.map(buildMappedTicket),
            serving: servingEntries.map(buildMappedTicket),
            recentlyServed: [],
            cancelled: [],
          },
        }}
      />
    </SandboxFrame>
  );
}
