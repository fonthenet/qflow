import { describe, it, expect } from 'vitest';
import {
  getDateStartIso,
  getDateEndIso,
  getOfficeDayStartIso,
  getOfficeDayEndIso,
} from '../office-day';

// ── getDateStartIso ─────────────────────────────────────────────────

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

  it('returns correct start for America/New_York during EDT (UTC-4)', () => {
    // March 30, 2026 is EDT. Midnight EDT = 04:00 UTC
    const result = getDateStartIso('2026-03-30', 'America/New_York');
    expect(result).toBe('2026-03-30T04:00:00.000Z');
  });

  it('returns correct start for America/New_York during EST (UTC-5)', () => {
    // January 15, 2026 is EST. Midnight EST = 05:00 UTC
    const result = getDateStartIso('2026-01-15', 'America/New_York');
    expect(result).toBe('2026-01-15T05:00:00.000Z');
  });

  it('returns correct start for Asia/Tokyo (UTC+9)', () => {
    // Midnight in Tokyo = 15:00 previous day UTC
    const result = getDateStartIso('2026-06-15', 'Asia/Tokyo');
    expect(result).toBe('2026-06-14T15:00:00.000Z');
  });

  it('returns correct start for Pacific/Auckland (UTC+12 or +13 DST)', () => {
    // January is NZDT (UTC+13). Midnight NZDT = 11:00 previous day UTC
    const result = getDateStartIso('2026-01-15', 'Pacific/Auckland');
    expect(result).toBe('2026-01-14T11:00:00.000Z');
  });

  it('returns correct start for Pacific/Honolulu (UTC-10)', () => {
    // Midnight HST = 10:00 same day UTC
    const result = getDateStartIso('2026-06-15', 'Pacific/Honolulu');
    expect(result).toBe('2026-06-15T10:00:00.000Z');
  });

  it('defaults to UTC when timezone is null', () => {
    const result = getDateStartIso('2026-01-15', null);
    expect(result).toBe('2026-01-15T00:00:00.000Z');
  });

  it('defaults to UTC when timezone is undefined', () => {
    const result = getDateStartIso('2026-01-15');
    expect(result).toBe('2026-01-15T00:00:00.000Z');
  });

  it('handles year boundary correctly', () => {
    // Midnight Jan 1 in Asia/Tokyo (UTC+9) = Dec 31 15:00 UTC
    const result = getDateStartIso('2027-01-01', 'Asia/Tokyo');
    expect(result).toBe('2026-12-31T15:00:00.000Z');
  });
});

// ── getDateEndIso ───────────────────────────────────────────────────

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

  it('returns correct end for America/New_York during EDT (UTC-4)', () => {
    // 23:59:59 EDT = 03:59:59 next day UTC
    const result = getDateEndIso('2026-03-30', 'America/New_York');
    expect(result).toBe('2026-03-31T03:59:59.000Z');
  });

  it('returns correct end for America/New_York during EST (UTC-5)', () => {
    // 23:59:59 EST = 04:59:59 next day UTC
    const result = getDateEndIso('2026-01-15', 'America/New_York');
    expect(result).toBe('2026-01-16T04:59:59.000Z');
  });

  it('returns correct end for Asia/Tokyo (UTC+9)', () => {
    // 23:59:59 JST = 14:59:59 same day UTC
    const result = getDateEndIso('2026-06-15', 'Asia/Tokyo');
    expect(result).toBe('2026-06-15T14:59:59.000Z');
  });

  it('defaults to UTC when timezone is null', () => {
    const result = getDateEndIso('2026-01-15', null);
    expect(result).toBe('2026-01-15T23:59:59.000Z');
  });

  it('handles year boundary — end of Dec 31 in UTC-5', () => {
    // 23:59:59 EST on Dec 31 = Jan 1 04:59:59 UTC
    const result = getDateEndIso('2026-12-31', 'America/New_York');
    expect(result).toBe('2027-01-01T04:59:59.000Z');
  });
});

// ── Consistency: start < end ────────────────────────────────────────

describe('start/end consistency', () => {
  const timezones = ['UTC', 'Africa/Algiers', 'America/New_York', 'Asia/Tokyo', 'Pacific/Honolulu'];
  const dates = ['2026-01-01', '2026-06-15', '2026-12-31'];

  for (const tz of timezones) {
    for (const date of dates) {
      it(`start < end for ${tz} on ${date}`, () => {
        const start = new Date(getDateStartIso(date, tz)).getTime();
        const end = new Date(getDateEndIso(date, tz)).getTime();
        expect(start).toBeLessThan(end);
        // The difference should be close to 24 hours (minus 1 second)
        const diffHours = (end - start) / (1000 * 60 * 60);
        expect(diffHours).toBeCloseTo(23 + 59 / 60 + 59 / 3600, 1);
      });
    }
  }
});
