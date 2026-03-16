type OfficeWithSettings = {
  name: string;
  settings?: unknown;
};

type BookingLinkOptions = {
  departmentId?: string | null;
  serviceId?: string | null;
};

export function slugifyOfficeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getOfficePublicSlug(office: OfficeWithSettings) {
  const settings =
    office.settings && typeof office.settings === 'object' && !Array.isArray(office.settings)
      ? (office.settings as Record<string, unknown>)
      : {};
  const configuredSlug = settings.platform_office_slug;
  return typeof configuredSlug === 'string' && configuredSlug.trim().length > 0
    ? configuredSlug
    : slugifyOfficeName(office.name);
}

export function matchesOfficePublicSlug(office: OfficeWithSettings, officeSlug: string) {
  return getOfficePublicSlug(office) === officeSlug;
}

export function buildKioskPath(office: OfficeWithSettings) {
  return `/kiosk/${getOfficePublicSlug(office)}`;
}

export function buildBookingPath(office: OfficeWithSettings, options: BookingLinkOptions = {}) {
  const params = new URLSearchParams();

  if (options.departmentId) {
    params.set('departmentId', options.departmentId);
  }

  if (options.serviceId) {
    params.set('serviceId', options.serviceId);
  }

  const query = params.toString();
  const basePath = `/book/${getOfficePublicSlug(office)}`;

  return query ? `${basePath}?${query}` : basePath;
}

export function buildBookingCheckInPath(office: OfficeWithSettings) {
  return `/book/${getOfficePublicSlug(office)}/checkin`;
}
