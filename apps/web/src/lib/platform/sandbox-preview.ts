import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildTrialTemplateStructure,
  applyTrialStructureToStarterOffice,
  isTrialTemplateStructureCompatible,
  normalizeTrialTemplateStructure,
} from '@/lib/platform/trial-structure';
import { getTrialPlatformSelection, resolvePlatformConfig } from '@/lib/platform/config';

type SandboxStatus = 'waiting' | 'called' | 'serving' | 'served' | 'cancelled';

export type SandboxPreviewData = {
  token: string;
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  office: {
    name: string;
    timezone: string;
  };
  scenario: {
    key: string;
    name: string;
    description: string;
    index: number;
    total: number;
    rotatesAutomatically: boolean;
  };
  officeSettings: Record<string, unknown>;
  serviceAreas: Array<{
    id: string;
    label: string;
    type?: string;
  }>;
  tablePresets: Array<{
    code: string;
    label: string;
    zone?: string;
    capacity?: number;
    minPartySize?: number;
    maxPartySize?: number;
    reservable?: boolean;
  }>;
  vocabulary: ReturnType<typeof resolvePlatformConfig>['experienceProfile']['vocabulary'];
  publicJoinProfile: ReturnType<typeof resolvePlatformConfig>['experienceProfile']['publicJoin'];
  kioskProfile: ReturnType<typeof resolvePlatformConfig>['experienceProfile']['kiosk'];
  displayProfile: ReturnType<typeof resolvePlatformConfig>['experienceProfile']['display'];
  queuePolicy: ReturnType<typeof resolvePlatformConfig>['queuePolicy'];
  workflowProfile: ReturnType<typeof resolvePlatformConfig>['workflowProfile'];
  lifecycleState: string;
  template: {
    id: string;
    title: string;
    version: string;
    vertical: string;
  };
  priorities: Array<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    weight: number | null;
  }>;
  departments: Array<{
    id: string;
    code: string;
    name: string;
    services: Array<{
      id: string;
      code: string;
      name: string;
      description?: string;
      estimatedServiceTime?: number;
    }>;
  }>;
  desks: Array<{
    id: string;
    name: string;
    displayName?: string;
    departmentCode: string;
    status?: 'open' | 'closed' | 'on_break';
  }>;
  displays: Array<{
    id: string;
    name: string;
    layout?: 'list' | 'grid' | 'department_split';
  }>;
  queueTickets: Array<{
    id: string;
    ticketNumber: string;
    status: SandboxStatus;
    name: string;
    source: 'walk_in' | 'reservation' | 'remote_join';
    departmentCode: string;
    departmentName: string;
    serviceCode: string;
    serviceName: string;
    deskName?: string;
    createdLabel: string;
    estimatedWaitMinutes: number;
    position: number;
    partySize?: number;
    seatingPreference?: string;
    reservationReference?: string | null;
    nextTableCode?: string | null;
    nextTableLabel?: string | null;
    needs?: string[];
  }>;
  bookings: Array<{
    id: string;
    reference: string;
    status: 'booked' | 'checked_in' | 'cancelled';
    name: string;
    email: string;
    departmentName: string;
    serviceName: string;
    timeLabel: string;
    partySize?: number;
    seatingPreference?: string;
    kind?: 'reservation' | 'walk_in_follow_up';
  }>;
  sampleSlots?: string[];
  links: {
    hub: string;
    booking: string;
    kiosk: string;
    desk: string;
    queue: string;
    display: string;
  };
};

export function resetSandboxPreviewToStock(
  preview: SandboxPreviewData
): SandboxPreviewData {
  const queueTickets = preview.queueTickets.map((ticket, index) => ({
    ...ticket,
    status: 'waiting' as const,
    deskName: undefined,
    nextTableCode: ticket.nextTableCode ?? null,
    nextTableLabel: ticket.nextTableLabel ?? null,
    createdLabel: index === 0 ? 'Joined just now' : `Joined ${index + 2} min ago`,
    estimatedWaitMinutes: Math.max(4, (index + 1) * 4),
    position: index + 1,
  }));

  const bookings = preview.bookings.map((booking, index) => ({
    ...booking,
    status: 'booked' as const,
    timeLabel: preview.sampleSlots?.[index % (preview.sampleSlots?.length ?? 1)] ?? booking.timeLabel,
  }));

  return {
    ...preview,
    scenario: {
      ...preview.scenario,
      name: 'Default sandbox state',
      description:
        'Fresh test mode with untouched queue, reservations, and tables so you can start the full flow from scratch.',
    },
    queueTickets,
    bookings,
  };
}

type SandboxQueueTicketPreview = SandboxPreviewData['queueTickets'][number];
type SandboxBookingPreview = SandboxPreviewData['bookings'][number];
type SandboxScenario = {
  key: string;
  name: string;
  description: string;
  queueTickets: SandboxQueueTicketPreview[];
  bookings: SandboxBookingPreview[];
  sampleSlots: string[];
};

function formatTicketNumber(code: string, index: number) {
  return `${code}-${String(index).padStart(3, '0')}`;
}

function sampleName(index: number) {
  const names = [
    'Sarah Bennett',
    'Omar Ali',
    'Nina Costa',
    'Marcus Reed',
    'Lina Haddad',
    'David Cole',
    'Maya Noor',
    'Adam Hill',
  ];

  return names[index % names.length];
}

function safeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function maybeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildServiceAreas(officeSettings: Record<string, unknown>) {
  return (Array.isArray(officeSettings.platform_service_areas)
    ? officeSettings.platform_service_areas
    : []
  )
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      id: safeString(entry.id, 'area'),
      label: safeString(entry.label, 'Area'),
      type: maybeString(entry.type) ?? undefined,
    }));
}

function buildTablePresets(officeSettings: Record<string, unknown>) {
  return (Array.isArray(officeSettings.platform_table_presets)
    ? officeSettings.platform_table_presets
    : []
  )
    .map((entry) => asRecord(entry))
      .map((entry) => ({
        code: safeString(entry.code, 'T1'),
        label: safeString(entry.label, 'Table'),
        zone: maybeString(entry.zone) ?? undefined,
        capacity: asNumber(entry.capacity),
      minPartySize: asNumber(entry.minPartySize),
      maxPartySize: asNumber(entry.maxPartySize),
        reservable: typeof entry.reservable === 'boolean' ? entry.reservable : undefined,
      }));
}

function getCompatibleTrialStructure(params: {
  settings: Record<string, unknown>;
  templateId: string;
  branchType: string;
  starterOffice: ReturnType<typeof buildTrialTemplateStructure> extends infer _T
    ? Parameters<typeof buildTrialTemplateStructure>[0]
    : never;
  includeDisplays: boolean;
}) {
  const sameTemplate =
    params.settings.platform_trial_structure_template_id === params.templateId;
  const sameBranchType =
    params.settings.platform_trial_structure_branch_type === params.branchType;

  if (!sameTemplate || !sameBranchType) {
    return buildTrialTemplateStructure(params.starterOffice, {
      includeDisplays: params.includeDisplays,
    });
  }

  if (
    !isTrialTemplateStructureCompatible({
      rawStructure: params.settings.platform_trial_structure,
      starterOffice: params.starterOffice,
    })
  ) {
    return buildTrialTemplateStructure(params.starterOffice, {
      includeDisplays: params.includeDisplays,
    });
  }

  return normalizeTrialTemplateStructure({
    rawStructure: params.settings.platform_trial_structure,
    starterOffice: params.starterOffice,
    includeDisplays: params.includeDisplays,
  });
}

function getDepartmentContext(departments: SandboxPreviewData['departments'], index: number) {
  const department = departments[index] ?? departments[0];
  const service = department?.services[index % Math.max(1, department?.services.length ?? 1)] ?? department?.services[0];
  return {
    departmentCode: department?.code ?? 'A',
    departmentName: department?.name ?? 'Main area',
    serviceCode: service?.code ?? 'MAIN',
    serviceName: service?.name ?? 'Main service',
  };
}

function buildRestaurantScenarioSet(params: {
  departments: SandboxPreviewData['departments'];
  desks: SandboxPreviewData['desks'];
  serviceAreas: SandboxPreviewData['serviceAreas'];
  tablePresets: SandboxPreviewData['tablePresets'];
}): SandboxScenario[] {
  const hostDesk = params.desks[0];
  const patioDesk = params.desks[1] ?? hostDesk;
  const barDesk = params.desks[2] ?? patioDesk ?? hostDesk;
  const primary = getDepartmentContext(params.departments, 0);
  const tableFor = (code: string) => params.tablePresets.find((table) => table.code === code);
  const serviceNameFor = (serviceCode: string, fallback: string) =>
    params.departments
      .flatMap((department) => department.services)
      .find((service) => service.code === serviceCode)?.name ?? fallback;
  const p2Name = serviceNameFor('P2', 'Party of 1-2');
  const p4Name = serviceNameFor('P4', 'Party of 3-4');
  const p6Name = serviceNameFor('P6', 'Party of 5-6');
  const p7Name = serviceNameFor('P7', 'Party of 7+');
  const reservationName = serviceNameFor('RSVP', 'Reservation Arrival');

  const makeTicket = (overrides: Partial<SandboxQueueTicketPreview>): SandboxQueueTicketPreview => ({
    id: overrides.id ?? `ticket-${Math.random().toString(36).slice(2, 8)}`,
    ticketNumber: overrides.ticketNumber ?? formatTicketNumber(primary.departmentCode, 10),
    status: overrides.status ?? 'waiting',
    name: overrides.name ?? 'Sandbox Guest',
    source: overrides.source ?? 'walk_in',
    departmentCode: overrides.departmentCode ?? primary.departmentCode,
    departmentName: overrides.departmentName ?? primary.departmentName,
    serviceCode: overrides.serviceCode ?? primary.serviceCode,
    serviceName: overrides.serviceName ?? primary.serviceName,
    deskName: overrides.deskName,
    createdLabel: overrides.createdLabel ?? 'Joined just now',
    estimatedWaitMinutes: overrides.estimatedWaitMinutes ?? 10,
    position: overrides.position ?? 1,
    partySize: overrides.partySize,
    seatingPreference: overrides.seatingPreference,
    reservationReference: overrides.reservationReference ?? null,
    nextTableCode: overrides.nextTableCode ?? null,
    nextTableLabel: overrides.nextTableLabel ?? null,
    needs: overrides.needs ?? [],
  });

  const makeBooking = (overrides: Partial<SandboxBookingPreview>): SandboxBookingPreview => ({
    id: overrides.id ?? `booking-${Math.random().toString(36).slice(2, 8)}`,
    reference: overrides.reference ?? 'RSVP-1001',
    status: overrides.status ?? 'booked',
    name: overrides.name ?? 'Sandbox Guest',
    email: overrides.email ?? 'sandbox@example.com',
    departmentName: overrides.departmentName ?? primary.departmentName,
    serviceName: overrides.serviceName ?? primary.serviceName,
    timeLabel: overrides.timeLabel ?? '07:00 PM',
    partySize: overrides.partySize,
    seatingPreference: overrides.seatingPreference,
    kind: overrides.kind ?? 'reservation',
  });

  return [
    {
      key: 'reservation-wave',
      name: 'Reservation wave',
      description: 'Dinner reservations are arriving together while hosts juggle check-ins, patio requests, and remote joins.',
      queueTickets: [
        makeTicket({
          id: 'reservation-wave-serving',
          ticketNumber: `${primary.departmentCode}-021`,
          status: 'serving',
          name: 'Lina Haddad',
          source: 'reservation',
          deskName: hostDesk?.displayName ?? hostDesk?.name,
          createdLabel: 'Seated now',
          estimatedWaitMinutes: 0,
          position: 0,
          serviceCode: 'P2',
          partySize: 2,
          serviceName: p2Name,
          seatingPreference: 'Indoor',
          reservationReference: 'RSVP-2103',
          nextTableCode: 'T2',
          nextTableLabel: tableFor('T2')?.label ?? 'Table 2',
        }),
        makeTicket({
          id: 'reservation-wave-called',
          ticketNumber: `${primary.departmentCode}-022`,
          status: 'called',
          name: 'Amina Perez',
          source: 'reservation',
          deskName: patioDesk?.displayName ?? patioDesk?.name,
          createdLabel: 'Notified just now',
          estimatedWaitMinutes: 0,
          position: 1,
          serviceCode: 'P4',
          partySize: 4,
          serviceName: p4Name,
          seatingPreference: 'Outdoor',
          reservationReference: 'RSVP-2104',
          nextTableCode: 'P1',
          nextTableLabel: tableFor('P1')?.label ?? 'Patio 1',
          needs: ['High chair'],
        }),
        makeTicket({
          id: 'reservation-wave-waiting-1',
          ticketNumber: `${primary.departmentCode}-023`,
          status: 'waiting',
          name: 'Marcus Reed',
          source: 'remote_join',
          createdLabel: 'Joined 6 min ago',
          estimatedWaitMinutes: 12,
          position: 1,
          serviceCode: 'P2',
          partySize: 2,
          serviceName: p2Name,
          seatingPreference: 'Bar',
          nextTableCode: 'B1',
          nextTableLabel: tableFor('B1')?.label ?? 'Bar 1',
        }),
        makeTicket({
          id: 'reservation-wave-waiting-2',
          ticketNumber: `${primary.departmentCode}-024`,
          status: 'waiting',
          name: 'Nina Costa',
          source: 'reservation',
          createdLabel: 'Checked in 3 min ago',
          estimatedWaitMinutes: 8,
          position: 2,
          serviceCode: 'P6',
          partySize: 6,
          serviceName: p6Name,
          seatingPreference: 'Indoor',
          reservationReference: 'RSVP-2105',
          nextTableCode: 'T4',
          nextTableLabel: tableFor('T4')?.label ?? 'Table 4',
          needs: ['Accessible seating'],
        }),
      ],
      bookings: [
        makeBooking({ id: 'reservation-wave-booked', reference: 'RSVP-2106', status: 'booked', name: 'Sarah Bennett', email: 'sarah@example.com', serviceName: reservationName, timeLabel: '07:15 PM', partySize: 2, seatingPreference: 'Indoor' }),
        makeBooking({ id: 'reservation-wave-checkin', reference: 'RSVP-2103', status: 'checked_in', name: 'Lina Haddad', email: 'lina@example.com', serviceName: reservationName, timeLabel: '07:00 PM', partySize: 2, seatingPreference: 'Indoor' }),
        makeBooking({ id: 'reservation-wave-cancelled', reference: 'RSVP-2101', status: 'cancelled', name: 'Omar Ali', email: 'omar@example.com', serviceName: reservationName, timeLabel: '06:45 PM', partySize: 4, seatingPreference: 'Outdoor' }),
      ],
      sampleSlots: ['06:30', '06:45', '07:00', '07:15', '07:30', '07:45'],
    },
    {
      key: 'patio-rush',
      name: 'Patio rush',
      description: 'Walk-ins and remote joins stack up for outdoor seating while one party is being seated and another is being recalled.',
      queueTickets: [
        makeTicket({
          id: 'patio-rush-serving',
          ticketNumber: `${primary.departmentCode}-031`,
          status: 'serving',
          name: 'Maya Noor',
          source: 'walk_in',
          deskName: patioDesk?.displayName ?? patioDesk?.name,
          createdLabel: 'Seating now',
          estimatedWaitMinutes: 0,
          position: 0,
          serviceCode: 'P4',
          partySize: 4,
          serviceName: p4Name,
          seatingPreference: 'Outdoor',
          nextTableCode: 'P1',
          nextTableLabel: tableFor('P1')?.label ?? 'Patio 1',
        }),
        makeTicket({
          id: 'patio-rush-called',
          ticketNumber: `${primary.departmentCode}-032`,
          status: 'called',
          name: 'Adam Hill',
          source: 'remote_join',
          deskName: patioDesk?.displayName ?? patioDesk?.name,
          createdLabel: 'Alert sent just now',
          estimatedWaitMinutes: 0,
          position: 1,
          serviceCode: 'P2',
          partySize: 2,
          serviceName: p2Name,
          seatingPreference: 'Outdoor',
          nextTableCode: 'P1',
          nextTableLabel: tableFor('P1')?.label ?? 'Patio 1',
        }),
        makeTicket({
          id: 'patio-rush-waiting-1',
          ticketNumber: `${primary.departmentCode}-033`,
          status: 'waiting',
          name: 'David Cole',
          source: 'walk_in',
          createdLabel: 'Joined 9 min ago',
          estimatedWaitMinutes: 14,
          position: 1,
          serviceCode: 'P2',
          partySize: 2,
          serviceName: p2Name,
          seatingPreference: 'Outdoor',
          nextTableCode: 'P1',
          nextTableLabel: tableFor('P1')?.label ?? 'Patio 1',
          needs: ['High chair'],
        }),
        makeTicket({
          id: 'patio-rush-waiting-2',
          ticketNumber: `${primary.departmentCode}-034`,
          status: 'waiting',
          name: 'Remote Join Guest',
          source: 'remote_join',
          createdLabel: 'Joined 5 min ago',
          estimatedWaitMinutes: 16,
          position: 2,
          serviceCode: 'P4',
          partySize: 3,
          serviceName: p4Name,
          seatingPreference: 'Outdoor',
          nextTableCode: 'P1',
          nextTableLabel: tableFor('P1')?.label ?? 'Patio 1',
        }),
        makeTicket({
          id: 'patio-rush-waiting-3',
          ticketNumber: `${primary.departmentCode}-035`,
          status: 'waiting',
          name: 'Walk-in Family',
          source: 'walk_in',
          createdLabel: 'Joined 2 min ago',
          estimatedWaitMinutes: 20,
          position: 3,
          serviceCode: 'P6',
          partySize: 6,
          serviceName: p6Name,
          seatingPreference: 'Indoor',
          nextTableCode: 'T4',
          nextTableLabel: tableFor('T4')?.label ?? 'Table 4',
          needs: ['Accessible seating'],
        }),
      ],
      bookings: [
        makeBooking({ id: 'patio-rush-booked', reference: 'RSVP-3101', status: 'booked', name: 'Maya Noor', email: 'maya@example.com', serviceName: reservationName, timeLabel: '06:30 PM', partySize: 4, seatingPreference: 'Outdoor' }),
        makeBooking({ id: 'patio-rush-checkin', reference: 'RSVP-3102', status: 'checked_in', name: 'Adam Hill', email: 'adam@example.com', serviceName: reservationName, timeLabel: '06:35 PM', partySize: 2, seatingPreference: 'Outdoor' }),
        makeBooking({ id: 'patio-rush-cancelled', reference: 'RSVP-3100', status: 'cancelled', name: 'Nina Costa', email: 'nina@example.com', serviceName: reservationName, timeLabel: '06:15 PM', partySize: 2, seatingPreference: 'Bar' }),
      ],
      sampleSlots: ['06:00', '06:15', '06:30', '06:45', '07:00', '07:15'],
    },
    {
      key: 'family-dinner-mix',
      name: 'Family dinner mix',
      description: 'Large parties, accessibility requests, and bar seating all show up together so the host can test edge cases.',
      queueTickets: [
        makeTicket({
          id: 'family-mix-serving',
          ticketNumber: `${primary.departmentCode}-041`,
          status: 'serving',
          name: 'Family Carter',
          source: 'reservation',
          deskName: hostDesk?.displayName ?? hostDesk?.name,
          createdLabel: 'Seated now',
          estimatedWaitMinutes: 0,
          position: 0,
          serviceCode: 'P7',
          partySize: 8,
          serviceName: p7Name,
          seatingPreference: 'Indoor',
          reservationReference: 'RSVP-4101',
          nextTableCode: 'PR1',
          nextTableLabel: tableFor('PR1')?.label ?? 'Private 1',
          needs: ['High chair'],
        }),
        makeTicket({
          id: 'family-mix-called',
          ticketNumber: `${primary.departmentCode}-042`,
          status: 'called',
          name: 'Omar Ali',
          source: 'walk_in',
          deskName: barDesk?.displayName ?? barDesk?.name,
          createdLabel: 'Called just now',
          estimatedWaitMinutes: 0,
          position: 1,
          serviceCode: 'P2',
          partySize: 2,
          serviceName: p2Name,
          seatingPreference: 'Bar',
          nextTableCode: 'B1',
          nextTableLabel: tableFor('B1')?.label ?? 'Bar 1',
        }),
        makeTicket({
          id: 'family-mix-waiting-1',
          ticketNumber: `${primary.departmentCode}-043`,
          status: 'waiting',
          name: 'Leila Group',
          source: 'reservation',
          createdLabel: 'Checked in 10 min ago',
          estimatedWaitMinutes: 18,
          position: 1,
          serviceCode: 'P6',
          partySize: 6,
          serviceName: p6Name,
          seatingPreference: 'Indoor',
          reservationReference: 'RSVP-4102',
          nextTableCode: 'T4',
          nextTableLabel: tableFor('T4')?.label ?? 'Table 4',
          needs: ['Accessible seating'],
        }),
        makeTicket({
          id: 'family-mix-waiting-2',
          ticketNumber: `${primary.departmentCode}-044`,
          status: 'waiting',
          name: 'Marcus Reed',
          source: 'remote_join',
          createdLabel: 'Joined 7 min ago',
          estimatedWaitMinutes: 11,
          position: 2,
          serviceCode: 'P4',
          partySize: 3,
          serviceName: p4Name,
          seatingPreference: 'Indoor',
          nextTableCode: 'T3',
          nextTableLabel: tableFor('T3')?.label ?? 'Table 3',
        }),
      ],
      bookings: [
        makeBooking({ id: 'family-mix-booked', reference: 'RSVP-4101', status: 'checked_in', name: 'Family Carter', email: 'carter@example.com', serviceName: reservationName, timeLabel: '07:30 PM', partySize: 8, seatingPreference: 'Indoor' }),
        makeBooking({ id: 'family-mix-booked-2', reference: 'RSVP-4102', status: 'booked', name: 'Leila Group', email: 'leila@example.com', serviceName: reservationName, timeLabel: '07:45 PM', partySize: 6, seatingPreference: 'Indoor' }),
        makeBooking({ id: 'family-mix-cancelled', reference: 'RSVP-4100', status: 'cancelled', name: 'Nina Costa', email: 'nina@example.com', serviceName: reservationName, timeLabel: '07:15 PM', partySize: 2, seatingPreference: 'Bar' }),
      ],
      sampleSlots: ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15'],
    },
  ];
}

function buildGenericScenarioSet(params: {
  departments: SandboxPreviewData['departments'];
  desks: SandboxPreviewData['desks'];
}): SandboxScenario[] {
  const firstDepartment = params.departments[0];
  const secondDepartment = params.departments[1] ?? firstDepartment;
  const firstService = firstDepartment?.services[0];
  const secondService = secondDepartment?.services[0] ?? firstService;
  const firstDesk =
    params.desks.find((desk) => desk.departmentCode === firstDepartment?.code) ?? params.desks[0];

  return [
    {
      key: 'balanced-day',
      name: 'Balanced day',
      description: 'A mix of booked, waiting, called, and serving activity across the queue.',
      queueTickets: [
        {
          id: 'ticket-waiting-1',
          ticketNumber: formatTicketNumber(firstDepartment?.code ?? 'A', 11),
          status: 'waiting' as const,
          name: sampleName(0),
          source: 'walk_in' as const,
          departmentCode: firstDepartment?.code ?? 'A',
          departmentName: firstDepartment?.name ?? 'Main area',
          serviceCode: firstService?.code ?? 'MAIN',
          serviceName: firstService?.name ?? 'Main service',
        createdLabel: 'Joined 4 min ago',
        estimatedWaitMinutes: 12,
        position: 2,
        partySize: undefined,
        seatingPreference: undefined,
        reservationReference: null,
        nextTableCode: null,
        nextTableLabel: null,
        needs: [],
      },
        {
          id: 'ticket-called-1',
          ticketNumber: formatTicketNumber(secondDepartment?.code ?? 'B', 12),
          status: 'called' as const,
          name: sampleName(1),
          source: 'reservation' as const,
          departmentCode: secondDepartment?.code ?? 'B',
          departmentName: secondDepartment?.name ?? 'Next area',
          serviceCode: secondService?.code ?? 'NEXT',
          serviceName: secondService?.name ?? 'Next service',
          deskName: firstDesk?.displayName ?? firstDesk?.name ?? 'Counter 1',
        createdLabel: 'Called just now',
        estimatedWaitMinutes: 0,
        position: 1,
        reservationReference: 'SBX-4103',
        partySize: undefined,
        seatingPreference: undefined,
        nextTableCode: null,
        nextTableLabel: null,
        needs: [],
      },
        {
          id: 'ticket-serving-1',
          ticketNumber: formatTicketNumber(firstDepartment?.code ?? 'A', 9),
          status: 'serving' as const,
          name: sampleName(2),
          source: 'remote_join' as const,
          departmentCode: firstDepartment?.code ?? 'A',
          departmentName: firstDepartment?.name ?? 'Main area',
          serviceCode: firstService?.code ?? 'MAIN',
          serviceName: firstService?.name ?? 'Main service',
          deskName: firstDesk?.displayName ?? firstDesk?.name ?? 'Counter 1',
        createdLabel: 'Serving now',
        estimatedWaitMinutes: 0,
        position: 0,
        partySize: undefined,
        seatingPreference: undefined,
        reservationReference: null,
        nextTableCode: null,
        nextTableLabel: null,
        needs: [],
      },
      ],
      bookings: [
        {
          id: 'booking-1',
          reference: 'SBX-4102',
          status: 'booked' as const,
          name: sampleName(4),
          email: 'sarah@example.com',
          departmentName: firstDepartment?.name ?? 'Main area',
          serviceName: firstService?.name ?? 'Main service',
          timeLabel: '09:30 AM',
          kind: 'reservation' as const,
        },
        {
          id: 'booking-2',
          reference: 'SBX-4103',
          status: 'checked_in' as const,
          name: sampleName(5),
          email: 'omar@example.com',
          departmentName: secondDepartment?.name ?? 'Next area',
          serviceName: secondService?.name ?? 'Next service',
          timeLabel: '09:45 AM',
          kind: 'reservation' as const,
        },
        {
          id: 'booking-3',
          reference: 'SBX-4104',
          status: 'cancelled' as const,
          name: sampleName(6),
          email: 'nina@example.com',
          departmentName: firstDepartment?.name ?? 'Main area',
          serviceName: firstService?.name ?? 'Main service',
          timeLabel: '10:15 AM',
          kind: 'reservation' as const,
        },
      ],
      sampleSlots: ['09:00', '09:30', '10:00', '10:30', '11:15', '11:45'],
    },
  ];
}

export function buildSandboxPreviewData(params: {
  organization: {
    id: string;
    name: string;
    logo_url?: string | null;
    settings?: Record<string, unknown> | null;
  };
  token: string;
}) {
  const settings = (params.organization.settings as Record<string, unknown> | null) ?? {};
  const lifecycleState = safeString(
    settings.platform_template_state,
    'template_trial_state'
  );
  const selection = getTrialPlatformSelection(settings);
  const config = resolvePlatformConfig({
    organizationSettings: settings,
    mode: 'trial',
  });
  const starterOffice =
    config.template.starterOffices.find(
      (office) => office.branchType === selection.branchType
    ) ?? config.template.starterOffices[0];

  if (!starterOffice) {
    return null;
  }

  const includeDisplays =
    typeof settings.platform_trial_create_starter_display === 'boolean'
      ? settings.platform_trial_create_starter_display
      : config.capabilityFlags.displayBoard;

  const appliedOffice = applyTrialStructureToStarterOffice({
    starterOffice,
    structure: getCompatibleTrialStructure({
      settings,
      templateId: selection.templateId,
      branchType: selection.branchType,
      starterOffice,
      includeDisplays,
    }),
  });

  const officeName = safeString(
    settings.platform_trial_office_name,
    `${params.organization.name} Main Location`
  );
  const timezone = safeString(settings.platform_trial_timezone, starterOffice.timezone);

  const departments = appliedOffice.departments.map((department, departmentIndex) => ({
    id: `sandbox-department-${departmentIndex + 1}`,
    code: department.code,
    name: department.name,
    services: department.services.map((service, serviceIndex) => ({
      id: `sandbox-service-${department.code}-${serviceIndex + 1}`,
      code: service.code,
      name: service.name,
    })),
  }));

  const desks = appliedOffice.desks.map((desk, deskIndex) => ({
    id: `sandbox-desk-${deskIndex + 1}`,
    name: desk.name,
    displayName: desk.displayName,
    departmentCode: desk.departmentCode,
    status: desk.status,
  }));

  const displays = appliedOffice.displayScreens.map((display, displayIndex) => ({
    id: `sandbox-display-${displayIndex + 1}`,
    name: display.name,
    layout: display.layout,
  }));
  const serviceAreas = buildServiceAreas(appliedOffice.officeSettings);
  const tablePresets = buildTablePresets(appliedOffice.officeSettings);
  const scenarios =
    config.template.vertical === 'restaurant'
      ? buildRestaurantScenarioSet({ departments, desks, serviceAreas, tablePresets })
      : buildGenericScenarioSet({ departments, desks });
  const scenarioIndex =
    scenarios.length > 0 ? Math.floor(Date.now() / (1000 * 60 * 5)) % scenarios.length : 0;
  const activeScenario = scenarios[scenarioIndex] ?? scenarios[0];
  const queueTickets = activeScenario?.queueTickets ?? [];
  const bookings = activeScenario?.bookings ?? [];

  const links = {
    hub: `/sandbox/${params.token}`,
    booking: `/sandbox/${params.token}/booking`,
    kiosk: `/sandbox/${params.token}/kiosk`,
    desk: `/sandbox/${params.token}/desk`,
    queue: `/sandbox/${params.token}/queue?ticket=${queueTickets[0]?.id ?? 'ticket-waiting-1'}`,
    display: `/sandbox/${params.token}/display`,
  };

  return {
    token: params.token,
    organization: {
      id: params.organization.id,
      name: params.organization.name,
      logoUrl: maybeString(params.organization.logo_url) ?? null,
    },
    office: {
      name: officeName,
      timezone,
    },
    scenario: {
      key: activeScenario?.key ?? 'sandbox',
      name: activeScenario?.name ?? 'Sandbox scenario',
      description: activeScenario?.description ?? 'Explore the setup without touching live data.',
      index: scenarioIndex,
      total: scenarios.length,
      rotatesAutomatically: scenarios.length > 1,
    },
    officeSettings: appliedOffice.officeSettings,
    serviceAreas,
    tablePresets,
    vocabulary: config.experienceProfile.vocabulary,
    publicJoinProfile: config.experienceProfile.publicJoin,
    kioskProfile: config.experienceProfile.kiosk,
    displayProfile: config.experienceProfile.display,
    queuePolicy: config.queuePolicy,
    workflowProfile: config.workflowProfile,
    lifecycleState,
    template: {
      id: config.template.id,
      title: config.template.title,
      version: config.selection.version,
      vertical: config.template.vertical,
    },
    priorities: config.template.starterPriorities.map((priority, index) => ({
      id: `sandbox-priority-${index + 1}`,
      name: priority.name,
      icon: priority.icon,
      color: priority.color,
      weight: priority.weight,
    })),
    departments,
    desks,
    displays,
    queueTickets,
    bookings,
    links,
    sampleSlots: activeScenario?.sampleSlots,
  } satisfies SandboxPreviewData;
}

export async function getSandboxPreviewByToken(token: string) {
  noStore();
  const supabase = createAdminClient();
  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, logo_url, settings')
    .contains('settings', {
      platform_trial_share_token: token,
      platform_template_state: 'template_trial_state',
    })
    .maybeSingle();

  if (!organization) {
    return null;
  }

  return buildSandboxPreviewData({
    organization: {
      id: organization.id,
      name: organization.name,
      logo_url: organization.logo_url,
      settings: (organization.settings as Record<string, unknown> | null) ?? {},
    },
    token,
  });
}
