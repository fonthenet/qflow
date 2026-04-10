import { describe, it, expect } from 'vitest';
import { isValidUUID, sanitizeString, sanitizePhone } from '../validation';

describe('isValidUUID', () => {
  it('accepts valid UUIDs', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    expect(isValidUUID('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('accepts uppercase UUIDs', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false); // no dashes
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false); // invalid hex
  });
});

describe('sanitizeString', () => {
  it('truncates at maxLength', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeString(long).length).toBe(500);
    expect(sanitizeString(long, 10).length).toBe(10);
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
    expect(sanitizeString('\n  test\t')).toBe('test');
  });

  it('trims before truncating', () => {
    const input = '  ' + 'a'.repeat(10);
    expect(sanitizeString(input, 5)).toBe('aaaaa');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeString('   ')).toBe('');
  });
});

describe('sanitizePhone', () => {
  it('keeps digits, plus, spaces, parens, and dashes', () => {
    expect(sanitizePhone('+213 555 1234')).toBe('+213 555 1234');
    expect(sanitizePhone('(555) 123-4567')).toBe('(555) 123-4567');
  });

  it('removes invalid characters', () => {
    expect(sanitizePhone('+213-555-abc-1234')).toBe('+213-555--1234');
  });

  it('truncates to 20 characters', () => {
    const long = '+1' + '2'.repeat(30);
    expect(sanitizePhone(long).length).toBeLessThanOrEqual(20);
  });

  it('trims the result', () => {
    expect(sanitizePhone('  +213 555  ')).toBe('+213 555');
  });
});
