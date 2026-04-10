import { slugifyValue, type IndustryTemplate } from '@qflo/shared';

interface OfficeSeedInput {
  template: IndustryTemplate;
  starterOffice: IndustryTemplate['starterOffices'][number];
  branchType: string;
  operatingModel: string;
  officeName: string;
}

export function buildStarterOfficeRecord(input: OfficeSeedInput) {
  return {
    operatingHours: input.starterOffice.operatingHours ?? null,
    settings: {
      branch_type: input.branchType,
      platform_template_id: input.template.id,
      platform_template_version: input.template.version.current,
      platform_branch_type: input.branchType,
      platform_operating_model: input.operatingModel,
      platform_office_slug: slugifyValue(input.officeName),
      platform_experience_profile: {
        dashboardMode: input.template.experienceProfile.dashboardMode,
        display: {
          privacySafe: input.template.capabilityFlags.privacySafeDisplay,
        },
      },
      ...input.starterOffice.officeSettings,
    } as Record<string, unknown>,
  };
}

export function buildStarterDisplayRecords(input: {
  template: IndustryTemplate;
  starterOffice: IndustryTemplate['starterOffices'][number];
  officeId: string;
  officeName: string;
  createStarterDisplay: boolean;
  generateScreenToken: (officeId?: string) => string;
}) {
  if (!input.createStarterDisplay || !input.template.capabilityFlags.displayBoard) {
    return [];
  }

  const displays =
    input.starterOffice.displayScreens.length > 0
      ? input.starterOffice.displayScreens
      : [
          {
            name: `${input.officeName} Main Screen`,
            layout: input.template.experienceProfile.display.defaultLayout,
            isActive: true,
            settings: {},
          },
        ];

  return displays.map((display, index) => ({
    office_id: input.officeId,
    name: display.name,
    // First display uses office token (unified with kiosk URL)
    screen_token: index === 0 ? input.generateScreenToken(input.officeId) : input.generateScreenToken(),
    layout: display.layout ?? input.template.experienceProfile.display.defaultLayout,
    is_active: display.isActive ?? true,
    settings: {
      theme: input.template.experienceProfile.display.theme,
      show_clock: input.template.experienceProfile.display.showClock,
      show_next_up: input.template.experienceProfile.display.showNextUp,
      show_department_breakdown: input.template.experienceProfile.display.showDepartmentBreakdown,
      announcement_sound: input.template.experienceProfile.display.announcementSound,
      ...(display.settings ?? {}),
    },
  }));
}

export function buildStarterDeskRecords(input: {
  starterOffice: IndustryTemplate['starterOffices'][number];
  officeId: string;
  departmentIdsByCode: Map<string, string>;
  serviceIdsByCode: Map<string, string>;
}) {
  return input.starterOffice.desks.flatMap((desk) => {
    const departmentId = input.departmentIdsByCode.get(desk.departmentCode);
    if (!departmentId) {
      return [];
    }

    const serviceIds =
      desk.serviceCodes?.map((code) => input.serviceIdsByCode.get(code)).filter(Boolean) ?? [];

    return [
      {
        desk: {
          office_id: input.officeId,
          department_id: departmentId,
          name: desk.name,
          display_name: desk.displayName ?? null,
          is_active: true,
          status: desk.status ?? 'open',
        },
        serviceIds: serviceIds as string[],
      },
    ];
  });
}

export function buildStarterRestaurantTableRecords(input: {
  starterOffice: IndustryTemplate['starterOffices'][number];
  officeId: string;
}) {
  const rawTables = Array.isArray(input.starterOffice.officeSettings.platform_table_presets)
    ? input.starterOffice.officeSettings.platform_table_presets
    : [];

  return rawTables.flatMap((table) => {
    if (!table || typeof table !== 'object') return [];
    const record = table as Record<string, unknown>;
    if (typeof record.code !== 'string' || typeof record.label !== 'string') return [];

    return [
      {
        office_id: input.officeId,
        code: record.code,
        label: record.label,
        zone: typeof record.zone === 'string' ? record.zone : null,
        capacity: typeof record.capacity === 'number' ? record.capacity : null,
        min_party_size:
          typeof record.minPartySize === 'number' ? record.minPartySize : null,
        max_party_size:
          typeof record.maxPartySize === 'number' ? record.maxPartySize : null,
        reservable:
          typeof record.reservable === 'boolean' ? record.reservable : true,
        status: 'available',
      },
    ];
  });
}

export function summarizeStarterSeed(input: {
  starterOffice: IndustryTemplate['starterOffices'][number];
}) {
  const departmentCount = input.starterOffice.departments.length;
  const serviceCount = input.starterOffice.departments.reduce(
    (total, department) => total + department.services.length,
    0
  );

  return {
    departmentCount,
    serviceCount,
    deskCount: input.starterOffice.desks.length,
    displayCount: input.starterOffice.displayScreens.length,
    tableCount: Array.isArray(input.starterOffice.officeSettings.platform_table_presets)
      ? input.starterOffice.officeSettings.platform_table_presets.length
      : 0,
  };
}
