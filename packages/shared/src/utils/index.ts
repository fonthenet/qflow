export * from './business-hours';
export * from './calendar';

/**
 * ISO-3166 alpha-2 codes for Arab League / Arabic-speaking countries.
 * Used to gate Arabic-only UI (e.g. Arabic queue codes, RTL-specific helpers)
 * so we don't show Arabic fields to orgs in France, the US, Kenya, etc.
 */
export const ARABIC_COUNTRY_CODES = new Set([
  'DZ', 'BH', 'KM', 'DJ', 'EG', 'IQ', 'JO', 'KW',
  'LB', 'LY', 'MR', 'MA', 'OM', 'PS', 'QA', 'SA',
  'SO', 'SD', 'SY', 'TN', 'AE', 'YE',
]);

export function isArabicCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return ARABIC_COUNTRY_CODES.has(country.toUpperCase());
}

export const isElectron = () =>
  typeof window !== 'undefined' && !!(window as any).electronAPI;

export const isServer = () => typeof window === 'undefined';

export function formatTicketNumber(departmentCode: string, sequence: number): string {
  return `${departmentCode}-${String(sequence).padStart(4, '0')}`;
}

export function estimateWaitMinutes(
  positionInQueue: number,
  avgServiceTimeMinutes: number
): number {
  return Math.ceil(positionInQueue * avgServiceTimeMinutes);
}

export function formatWaitTime(minutes: number): string {
  if (minutes < 1) return 'Less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}min`;
}

export function slugifyValue(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function deepMergeRecords<T extends Record<string, unknown>>(
  base: T,
  ...overrides: Array<Record<string, unknown> | null | undefined>
): T {
  const output: Record<string, unknown> = { ...base };

  for (const override of overrides) {
    if (!override) continue;
    for (const [key, value] of Object.entries(override)) {
      const current = output[key];
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        current &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        output[key] = deepMergeRecords(
          current as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        output[key] = value;
      }
    }
  }

  return output as T;
}
