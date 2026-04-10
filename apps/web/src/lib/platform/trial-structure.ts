import {
  slugifyValue,
  type IndustryTemplate,
  type TrialTemplateDepartmentDraft,
  type TrialTemplateDeskDraft,
  type TrialTemplateDisplayDraft,
  type TrialTemplateStructure,
} from '@qflo/shared';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function uniqueCode(base: string, usedCodes: Set<string>, fallbackPrefix: string) {
  const normalizedBase = slugifyValue(base).replace(/-/g, '').toUpperCase();
  let candidate = (normalizedBase || fallbackPrefix).slice(0, 8);
  if (candidate.length === 0) candidate = fallbackPrefix;
  let next = candidate;
  let index = 2;

  while (usedCodes.has(next)) {
    const suffix = String(index);
    next = `${candidate.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    index += 1;
  }

  usedCodes.add(next);
  return next;
}

export function buildTrialTemplateStructure(
  starterOffice: IndustryTemplate['starterOffices'][number],
  options?: { includeDisplays?: boolean }
): TrialTemplateStructure {
  return {
    departments: starterOffice.departments.map((department) => ({
      code: department.code,
      name: department.name,
      enabled: true,
      services: department.services.map((service) => ({
        code: service.code,
        name: service.name,
        enabled: true,
      })),
    })),
    desks: starterOffice.desks.map((desk) => ({
      name: desk.name,
      departmentCode: desk.departmentCode,
      serviceCodes: desk.serviceCodes,
      displayName: desk.displayName,
      status: desk.status,
      enabled: true,
    })),
    displays:
      options?.includeDisplays === false
        ? []
        : starterOffice.displayScreens.map((display) => ({
            name: display.name,
            layout: display.layout,
            enabled: display.isActive ?? true,
          })),
  };
}

function normalizeDepartmentDrafts(
  value: unknown,
  starterOffice: IndustryTemplate['starterOffices'][number]
): TrialTemplateDepartmentDraft[] {
  const rawDepartments = Array.isArray(value) ? value : [];
  const templateDepartmentMap = new Map(
    starterOffice.departments.map((department) => [department.code, department])
  );
  const usedDepartmentCodes = new Set<string>();
  const normalized: TrialTemplateDepartmentDraft[] = [];

  for (const raw of rawDepartments) {
    const record = asRecord(raw);
    const templateDepartment =
      typeof record.code === 'string' ? templateDepartmentMap.get(record.code) : undefined;
    const name = asString(record.name, templateDepartment?.name ?? 'New area');
    const code = uniqueCode(
      asString(record.code, name),
      usedDepartmentCodes,
      'AREA'
    );
    const usedServiceCodes = new Set<string>();
    const templateServices = new Map(
      (templateDepartment?.services ?? []).map((service) => [service.code, service])
    );
    const rawServices = Array.isArray(record.services) ? record.services : [];

    const services = rawServices
      .map((rawService) => {
        const serviceRecord = asRecord(rawService);
        const templateService =
          typeof serviceRecord.code === 'string'
            ? templateServices.get(serviceRecord.code)
            : undefined;
        const serviceName = asString(
          serviceRecord.name,
          templateService?.name ?? 'New offering'
        );

        return {
          code: uniqueCode(
            asString(serviceRecord.code, serviceName),
            usedServiceCodes,
            'SERV'
          ),
          name: serviceName,
          enabled: asBoolean(serviceRecord.enabled, true),
        };
      })
      .filter((service) => service.name.trim().length > 0);

    if (name.trim().length > 0) {
      normalized.push({
        code,
        name,
        enabled: asBoolean(record.enabled, true),
        services,
      });
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return buildTrialTemplateStructure(starterOffice).departments;
}

function normalizeDeskDrafts(
  value: unknown,
  departments: TrialTemplateDepartmentDraft[],
  starterOffice: IndustryTemplate['starterOffices'][number]
): TrialTemplateDeskDraft[] {
  const rawDesks = Array.isArray(value) ? value : [];
  const validDepartmentCodes = new Set(departments.map((department) => department.code));
  const templateDeskMap = new Map(starterOffice.desks.map((desk) => [desk.name, desk]));
  const allServiceCodesByDepartment = new Map(
    departments.map((department) => [
      department.code,
      department.services.map((service) => service.code),
    ])
  );
  const normalized = rawDesks
    .map((rawDesk) => {
      const record = asRecord(rawDesk);
      const templateDesk =
        typeof record.name === 'string' ? templateDeskMap.get(record.name) : undefined;
      const departmentCode = asString(
        record.departmentCode,
        templateDesk?.departmentCode ?? departments[0]?.code ?? ''
      );
      if (!validDepartmentCodes.has(departmentCode)) {
        return null;
      }

      const rawServiceCodes = Array.isArray(record.serviceCodes)
        ? record.serviceCodes.filter((value): value is string => typeof value === 'string')
        : templateDesk?.serviceCodes ?? allServiceCodesByDepartment.get(departmentCode) ?? [];
      const validServiceCodes = new Set(allServiceCodesByDepartment.get(departmentCode) ?? []);

      const normalizedDesk: TrialTemplateDeskDraft = {
        name: asString(record.name, templateDesk?.name ?? 'Front desk'),
        departmentCode,
        serviceCodes: rawServiceCodes.filter((code) => validServiceCodes.has(code)),
        displayName:
          typeof record.displayName === 'string'
            ? record.displayName
            : templateDesk?.displayName,
        status:
          record.status === 'closed' || record.status === 'on_break' || record.status === 'open'
            ? record.status
            : templateDesk?.status ?? 'open',
        enabled: asBoolean(record.enabled, true),
      };

      return normalizedDesk;
    })
    .filter((desk) => desk !== null && desk.name.trim().length > 0);

  if (normalized.length > 0) {
    return normalized as TrialTemplateDeskDraft[];
  }

  return buildTrialTemplateStructure(starterOffice).desks;
}

function normalizeDisplayDrafts(
  value: unknown,
  starterOffice: IndustryTemplate['starterOffices'][number],
  includeDisplays: boolean
): TrialTemplateDisplayDraft[] {
  if (!includeDisplays) {
    return [];
  }

  const rawDisplays = Array.isArray(value) ? value : [];
  const templateDisplayMap = new Map(
    starterOffice.displayScreens.map((display) => [display.name, display])
  );
  const normalized = rawDisplays
    .map((rawDisplay) => {
      const record = asRecord(rawDisplay);
      const templateDisplay =
        typeof record.name === 'string' ? templateDisplayMap.get(record.name) : undefined;

      return {
        name: asString(record.name, templateDisplay?.name ?? 'Main display'),
        layout:
          record.layout === 'list' || record.layout === 'grid' || record.layout === 'department_split'
            ? record.layout
            : templateDisplay?.layout,
        enabled: asBoolean(record.enabled, true),
      } satisfies TrialTemplateDisplayDraft;
    })
    .filter((display) => display.name.trim().length > 0);

  if (normalized.length > 0) {
    return normalized;
  }

  return buildTrialTemplateStructure(starterOffice).displays;
}

export function normalizeTrialTemplateStructure(params: {
  rawStructure: unknown;
  starterOffice: IndustryTemplate['starterOffices'][number];
  includeDisplays: boolean;
}): TrialTemplateStructure {
  const record = asRecord(params.rawStructure);
  const departments = normalizeDepartmentDrafts(record.departments, params.starterOffice);

  return {
    departments,
    desks: normalizeDeskDrafts(record.desks, departments, params.starterOffice),
    displays: normalizeDisplayDrafts(
      record.displays,
      params.starterOffice,
      params.includeDisplays
    ),
  };
}

export function isTrialTemplateStructureCompatible(params: {
  rawStructure: unknown;
  starterOffice: IndustryTemplate['starterOffices'][number];
}): boolean {
  const record = asRecord(params.rawStructure);
  const rawDepartments = Array.isArray(record.departments) ? record.departments : [];

  if (rawDepartments.length === 0) {
    return false;
  }

  const starterDepartmentCodes = new Set(
    params.starterOffice.departments.map((department) => department.code)
  );
  const starterServiceCodes = new Set(
    params.starterOffice.departments.flatMap((department) =>
      department.services.map((service) => service.code)
    )
  );

  let matchingDepartments = 0;
  let matchingServices = 0;
  let totalServices = 0;

  for (const rawDepartment of rawDepartments) {
    const department = asRecord(rawDepartment);
    const departmentCode = typeof department.code === 'string' ? department.code : '';
    if (starterDepartmentCodes.has(departmentCode)) {
      matchingDepartments += 1;
    }

    const rawServices = Array.isArray(department.services) ? department.services : [];
    for (const rawService of rawServices) {
      const service = asRecord(rawService);
      const serviceCode = typeof service.code === 'string' ? service.code : '';
      totalServices += 1;
      if (starterServiceCodes.has(serviceCode)) {
        matchingServices += 1;
      }
    }
  }

  if (matchingDepartments === 0) {
    return false;
  }

  if (totalServices === 0) {
    return true;
  }

  return matchingServices > 0;
}

export function applyTrialStructureToStarterOffice(params: {
  starterOffice: IndustryTemplate['starterOffices'][number];
  structure: TrialTemplateStructure;
}) {
  const enabledDepartments = params.structure.departments
    .filter((department) => department.enabled)
    .map((department) => ({
      ...params.starterOffice.departments.find((entry) => entry.code === department.code),
      name: department.name,
      code: department.code,
      services: department.services
        .filter((service) => service.enabled)
        .map((service, index) => {
          const base =
            params.starterOffice.departments
              .find((entry) => entry.code === department.code)
              ?.services.find((entry) => entry.code === service.code) ?? {};

          return {
            ...base,
            name: service.name,
            code: service.code,
            sortOrder: index + 1,
          };
        }),
    }))
    .filter((department) => department.services.length > 0);

  const enabledDepartmentCodes = new Set(enabledDepartments.map((department) => department.code));
  const enabledServiceCodes = new Set(
    enabledDepartments.flatMap((department) => department.services.map((service) => service.code))
  );

  return {
    ...params.starterOffice,
    departments: enabledDepartments,
    desks: params.structure.desks
      .filter((desk) => desk.enabled && enabledDepartmentCodes.has(desk.departmentCode))
      .map((desk) => ({
        name: desk.name,
        departmentCode: desk.departmentCode,
        displayName: desk.displayName,
        serviceCodes:
          desk.serviceCodes?.filter((code) => enabledServiceCodes.has(code)) ??
          enabledDepartments
            .find((department) => department.code === desk.departmentCode)
            ?.services.map((service) => service.code),
        status: desk.status,
      })),
    displayScreens: params.structure.displays
      .filter((display) => display.enabled)
      .map((display) => {
        const base =
          params.starterOffice.displayScreens.find((entry) => entry.name === display.name) ?? {};

        return {
          ...base,
          name: display.name,
          layout: display.layout,
          isActive: true,
        };
      }),
  };
}
