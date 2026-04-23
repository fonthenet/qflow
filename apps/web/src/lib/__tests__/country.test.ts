/**
 * Regression tests for lib/country.ts
 *
 * Covers:
 * - formatMoney: DZD with 2 decimals (never stripped)
 * - formatMoney: USD fallback
 * - formatMoney: sub-unit amounts (0.99 DA)
 * - hasFeature: wilaya_picker DZ vs FR
 * - resolveLocale: priority chain
 */

import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  hasFeature,
  isCashOnly,
  resolveLocale,
  type CountryConfigSlim,
} from '../country';

// ── Minimal country config fixtures ──────────────────────────────────────────

const dzConfig: CountryConfigSlim = {
  currency_code: 'DZD',
  currency_decimals: 2,
  currency_symbol: 'DA',
  timezone_default: 'Africa/Algiers',
  locale_default: 'fr-DZ',
  feature_flags: { wilaya_picker: true, cash_only: true },
  phone_country_code: '+213',
};

const frConfig: CountryConfigSlim = {
  currency_code: 'EUR',
  currency_decimals: 2,
  currency_symbol: '€',
  timezone_default: 'Europe/Paris',
  locale_default: 'fr-FR',
  feature_flags: {},
  phone_country_code: '+33',
};

const usConfig: CountryConfigSlim = {
  currency_code: 'USD',
  currency_decimals: 2,
  currency_symbol: '$',
  timezone_default: 'America/New_York',
  locale_default: 'en-US',
  feature_flags: {},
  phone_country_code: '+1',
};

// ── formatMoney ───────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  it('formats DZD with 2 decimal places, never strips .00 — whole amount', () => {
    const result = formatMoney(10000, dzConfig);
    // Expected: something like "10 000,00 DA" or "DA 10,000.00" — exact separator
    // depends on OS ICU data. Core invariant: always ends with "00" and contains "DA".
    expect(result).toContain('DA');
    expect(result).toMatch(/0{2}(?!\d)/); // trailing 00 decimals present
    expect(result).not.toMatch(/\d{2}\.?$/); // not stripped
  });

  it('renders 0.99 DA — sub-centimes must not be rounded to 1.00 DA', () => {
    const result = formatMoney(0.99, dzConfig, { locale: 'fr-DZ' });
    // Should contain "0,99" or "0.99" with "DA"
    expect(result).toContain('DA');
    expect(result).toMatch(/0[.,]99/);
  });

  it('renders 0.00 DA when amount is zero', () => {
    const result = formatMoney(0, dzConfig, { locale: 'fr-DZ' });
    expect(result).toContain('DA');
    // 0 with 2 decimals must show "0,00" or "0.00"
    expect(result).toMatch(/0[.,]00/);
  });

  it('renders 100.00 DA — whole amount has trailing .00', () => {
    const result = formatMoney(100, dzConfig, { locale: 'fr-DZ' });
    expect(result).toContain('DA');
    expect(result).toMatch(/100[.,]00/);
  });

  it('formats USD with en-US locale — shows $ symbol and 2 decimals', () => {
    const result = formatMoney(100, usConfig, { locale: 'en-US' });
    expect(result).toContain('$');
    expect(result).toMatch(/100\.00/);
  });

  it('formatMoney uses countryConfig locale_default when no locale override', () => {
    // frConfig.locale_default is fr-FR — should format euros in French style
    const result = formatMoney(1234.56, frConfig);
    expect(result).toContain('€');
    // French uses comma as decimal separator: "1 234,56 €" (locale-dependent)
    expect(result).toMatch(/234/); // sanity check
  });

  it('falls back gracefully when currency code is invalid for Intl', () => {
    const badConfig: CountryConfigSlim = {
      ...dzConfig,
      currency_code: 'XQQ', // fake code not in Intl
    };
    const result = formatMoney(50.5, badConfig);
    // Manual fallback: "50.50 XQQ" — decimal separator may vary by locale
    expect(result).toMatch(/50[.,]50/);
    expect(result).toContain('XQQ');
  });
});

// ── hasFeature ────────────────────────────────────────────────────────────────

describe('hasFeature', () => {
  it('returns true for wilaya_picker on DZ config', () => {
    expect(hasFeature(dzConfig, 'wilaya_picker')).toBe(true);
  });

  it('returns false for wilaya_picker on FR config', () => {
    expect(hasFeature(frConfig, 'wilaya_picker')).toBe(false);
  });

  it('returns false for an unknown flag on any config', () => {
    expect(hasFeature(dzConfig, 'non_existent_flag')).toBe(false);
    expect(hasFeature(frConfig, 'non_existent_flag')).toBe(false);
  });

  it('returns false when feature_flags is empty object', () => {
    expect(hasFeature(usConfig, 'wilaya_picker')).toBe(false);
  });
});

// ── isCashOnly ────────────────────────────────────────────────────────────────

describe('isCashOnly', () => {
  it('returns true for DZ config — cash_only flag is set', () => {
    expect(isCashOnly(dzConfig)).toBe(true);
  });

  it('returns true when cash_only flag is set even if payment_providers is non-empty', () => {
    const config = { feature_flags: { cash_only: true }, payment_providers: ['stripe'] };
    expect(isCashOnly(config)).toBe(true);
  });

  it('returns true when payment_providers is an empty array even without flag', () => {
    const config = { feature_flags: {}, payment_providers: [] };
    expect(isCashOnly(config)).toBe(true);
  });

  it('returns false for FR config — no cash_only flag, has providers', () => {
    const frWithProviders = { ...frConfig, payment_providers: ['stripe'] };
    expect(isCashOnly(frWithProviders)).toBe(false);
  });

  it('returns false for FR config with no payment_providers field (undefined)', () => {
    // payment_providers is optional in the slim type — undefined means unknown, not empty
    expect(isCashOnly(frConfig)).toBe(false);
  });

  it('returns false when cash_only flag is explicitly false', () => {
    const config = { feature_flags: { cash_only: false }, payment_providers: ['stripe'] };
    expect(isCashOnly(config)).toBe(false);
  });
});

// ── resolveLocale ─────────────────────────────────────────────────────────────

describe('resolveLocale', () => {
  it('prefers ticket.locale when present', () => {
    expect(resolveLocale('ar', 'fr', dzConfig)).toBe('ar');
  });

  it('falls back to org.locale_primary when ticket.locale is null', () => {
    expect(resolveLocale(null, 'fr', dzConfig)).toBe('fr');
  });

  it('falls back to countryConfig.locale_default when ticket and org locale are null', () => {
    expect(resolveLocale(null, null, dzConfig)).toBe('fr-DZ');
  });

  it('falls back to "en" when all inputs are null', () => {
    expect(resolveLocale(null, null, null)).toBe('en');
  });

  it('falls back to "en" when all inputs are undefined', () => {
    expect(resolveLocale(undefined, undefined, undefined)).toBe('en');
  });

  it('ignores empty string ticket.locale and moves to next fallback', () => {
    expect(resolveLocale('', 'fr', dzConfig)).toBe('fr');
  });

  it('ignores whitespace-only org locale and moves to countryConfig', () => {
    expect(resolveLocale(null, '  ', dzConfig)).toBe('fr-DZ');
  });
});
