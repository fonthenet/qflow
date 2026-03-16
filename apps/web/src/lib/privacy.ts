export type IntakeVisibility = 'public' | 'staff_only' | 'internal';
export type CustomerDataScope = 'public' | 'staff' | 'admin';
export type DisplayPrivacyMode = 'full_name' | 'first_name_initial' | 'ticket_only';

export interface IntakeFieldPrivacyDefinition {
  field_name: string;
  visibility?: string | null;
  consent_flag?: string | null;
}

const SENSITIVE_FIELD_PATTERNS = [
  /phone/i,
  /email/i,
  /symptom/i,
  /reason/i,
  /diagnos/i,
  /condition/i,
  /dob/i,
  /birth/i,
  /address/i,
  /insurance/i,
  /ssn/i,
  /social/i,
  /passport/i,
  /license/i,
  /reference/i,
  /notes?/i,
];

function normalizeVisibility(value: string | null | undefined): IntakeVisibility {
  if (value === 'staff_only' || value === 'internal') {
    return value;
  }

  return 'public';
}

export function canAccessIntakeField(
  visibility: string | null | undefined,
  scope: CustomerDataScope
) {
  const normalized = normalizeVisibility(visibility);

  if (scope === 'admin') {
    return true;
  }

  if (scope === 'staff') {
    return normalized !== 'internal';
  }

  return normalized === 'public' || normalized === 'staff_only';
}

export function filterVisibleIntakeFields<T extends IntakeFieldPrivacyDefinition>(
  fields: T[],
  scope: CustomerDataScope
) {
  return fields.filter((field) => canAccessIntakeField(field.visibility, scope));
}

function isSensitiveFallbackField(fieldName: string) {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

export function sanitizeCustomerData(
  customerData: Record<string, unknown> | null | undefined,
  fields: IntakeFieldPrivacyDefinition[] = [],
  scope: CustomerDataScope = 'staff'
) {
  if (!customerData) {
    return null;
  }

  const allowedKeys = new Set(
    filterVisibleIntakeFields(fields, scope).map((field) => field.field_name)
  );
  const hasFieldDefinitions = allowedKeys.size > 0;

  const entries = Object.entries(customerData).filter(([key]) => {
    if (hasFieldDefinitions) {
      return allowedKeys.has(key);
    }

    if (scope === 'admin') {
      return true;
    }

    if (scope === 'staff') {
      return true;
    }

    return !isSensitiveFallbackField(key);
  });

  if (entries.length === 0) {
    return null;
  }

  return Object.fromEntries(entries);
}

export function maskDisplayName(
  value: unknown,
  mode: DisplayPrivacyMode = 'full_name'
): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (mode === 'ticket_only') {
    return null;
  }

  if (mode === 'first_name_initial') {
    const [firstName, ...rest] = normalized.split(' ');
    const lastInitial = rest[0]?.charAt(0);
    return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
  }

  return normalized;
}
