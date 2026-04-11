const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function sanitizeString(value: string, maxLength = 500): string {
  return value.trim().slice(0, maxLength);
}

export function sanitizePhone(value: string, maxLength = 20): string {
  // Keep only digits, +, and spaces
  return value.replace(/[^\d+\s()-]/g, '').trim().slice(0, maxLength);
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
