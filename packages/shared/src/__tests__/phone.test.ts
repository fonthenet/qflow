import { describe, it, expect } from 'vitest';
import { normalizePhone, resolveDialCode, TZ_DIAL, ISO_DIAL } from '../phone';

describe('TZ_DIAL', () => {
  it('maps Africa/Algiers to 213', () => {
    expect(TZ_DIAL['Africa/Algiers']).toBe('213');
  });
  it('maps America/New_York to 1', () => {
    expect(TZ_DIAL['America/New_York']).toBe('1');
  });
  it('maps Asia/Dubai to 971', () => {
    expect(TZ_DIAL['Asia/Dubai']).toBe('971');
  });
  it('has at least 30 entries', () => {
    expect(Object.keys(TZ_DIAL).length).toBeGreaterThanOrEqual(30);
  });
});

describe('ISO_DIAL', () => {
  it('maps DZ to 213', () => {
    expect(ISO_DIAL['DZ']).toBe('213');
  });
  it('maps US to 1', () => {
    expect(ISO_DIAL['US']).toBe('1');
  });
  it('maps FR to 33', () => {
    expect(ISO_DIAL['FR']).toBe('33');
  });
});

describe('resolveDialCode', () => {
  it('prefers countryCode over timezone', () => {
    expect(resolveDialCode('Africa/Algiers', 'FR')).toBe('33');
  });
  it('falls back to timezone when no countryCode', () => {
    expect(resolveDialCode('Africa/Algiers')).toBe('213');
  });
  it('returns null for unknown values', () => {
    expect(resolveDialCode('Unknown/Zone', 'XX')).toBeNull();
  });
  it('is case-insensitive for country code', () => {
    expect(resolveDialCode(null, 'dz')).toBe('213');
  });
});

describe('normalizePhone', () => {
  // International format
  it('strips + and returns digits', () => {
    expect(normalizePhone('+213551234567')).toBe('213551234567');
  });
  it('handles +1 US numbers', () => {
    expect(normalizePhone('+16612346622')).toBe('16612346622');
  });

  // Local format with leading 0 (Algeria)
  it('converts Algerian local 0 format with timezone', () => {
    expect(normalizePhone('0551234567', 'Africa/Algiers')).toBe('213551234567');
  });
  it('converts Algerian local 0 format with country code', () => {
    expect(normalizePhone('0551234567', null, 'DZ')).toBe('213551234567');
  });

  // Local format with leading 0 (France)
  it('converts French local 0 format', () => {
    expect(normalizePhone('0612345678', 'Europe/Paris')).toBe('33612345678');
  });

  // Already has country code (no +)
  it('keeps number that already starts with country code', () => {
    expect(normalizePhone('213551234567', 'Africa/Algiers')).toBe('213551234567');
  });
  it('detects US number without +', () => {
    expect(normalizePhone('16612346622')).toBe('16612346622');
  });

  // US 10-digit
  it('prepends 1 to 10-digit US number', () => {
    expect(normalizePhone('6612346622')).toBe('16612346622');
  });

  // 9-digit Algerian without leading 0
  it('handles 9-digit Algerian subscriber number', () => {
    expect(normalizePhone('551234567', 'Africa/Algiers')).toBe('213551234567');
  });

  // 9-digit French without leading 0
  it('handles 9-digit French subscriber number', () => {
    expect(normalizePhone('612345678', 'Europe/Paris')).toBe('33612345678');
  });

  // WhatsApp prefix
  it('strips whatsapp: prefix', () => {
    expect(normalizePhone('whatsapp:+16612346622')).toBe('16612346622');
  });

  // 00 international prefix
  it('strips 00 international prefix', () => {
    expect(normalizePhone('00213551234567')).toBe('213551234567');
  });

  // Too short
  it('returns null for numbers shorter than 7 digits', () => {
    expect(normalizePhone('12345')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  // Spaces and dashes
  it('strips spaces and dashes', () => {
    expect(normalizePhone('+213 55 123 4567')).toBe('213551234567');
  });
  it('strips dashes', () => {
    expect(normalizePhone('+1-661-234-6622')).toBe('16612346622');
  });

  // Generic short local with dial code
  it('prepends dial code for short local number', () => {
    expect(normalizePhone('1234567', 'Africa/Algiers')).toBe('2131234567');
  });
});
