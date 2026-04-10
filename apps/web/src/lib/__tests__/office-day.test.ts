import { describe, it, expect } from 'vitest';
import { getDateStartIso, getDateEndIso } from '../office-day';

describe('getDateStartIso', () => {
  it('returns midnight UTC for UTC timezone', () => {
    const result = getDateStartIso('2026-03-30', 'UTC');
    expect(result).toBe('2026-03-30T00:00:00.000Z');
  });

  it('returns correct start for Africa/Algiers (UTC+1)', () => {
    // Midnight in Algiers = 23:00 previous day UTC
    const result = getDateStartIso('2026-03-30', 'Africa/Algiers');
    expect(result).toBe('2026-03-29T23:00:00.000Z');
  });

  it('returns correct start for America/New_York (UTC-4 or UTC-5)', () => {
    // In March 2026, EST ended March 8 (DST starts), so March 30 is EDT (UTC-4)
    // Midnight EDT = 04:00 UTC
    const result = getDateStartIso('2026-03-30', 'America/New_York');
    expect(result).toBe('2026-03-30T04:00:00.000Z');
  });

  it('returns correct start for Asia/Tokyo (UTC+9)', () => {
    // Midnight in Tokyo = 15:00 previous day UTC
    const result = getDateStartIso('2026-06-15', 'Asia/Tokyo');
    expect(result).toBe('2026-06-14T15:00:00.000Z');
  });

  it('defaults to UTC when timezone is null', () => {
    const result = getDateStartIso('2026-01-15', null);
    expect(result).toBe('2026-01-15T00:00:00.000Z');
  });

  it('defaults to UTC when timezone is undefined', () => {
    const result = getDateStartIso('2026-01-15');
    expect(result).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('getDateEndIso', () => {
  it('returns 23:59:59 UTC for UTC timezone', () => {
    const result = getDateEndIso('2026-03-30', 'UTC');
    expect(result).toBe('2026-03-30T23:59:59.000Z');
  });

  it('returns correct end for Africa/Algiers (UTC+1)', () => {
    // 23:59:59 in Algiers = 22:59:59 UTC same day
    const result = getDateEndIso('2026-03-30', 'Africa/Algiers');
    expect(result).toBe('2026-03-30T22:59:59.000Z');
  });

  it('returns correct end for America/New_York (EDT, UTC-4)', () => {
    // 23:59:59 EDT = 03:59:59 next day UTC
    const result = getDateEndIso('2026-03-30', 'America/New_York');
    expect(result).toBe('2026-03-31T03:59:59.000Z');
  });

  it('defaults to UTC when timezone is null', () => {
    const result = getDateEndIso('2026-01-15', null);
    expect(result).toBe('2026-01-15T23:59:59.000Z');
  });
});
