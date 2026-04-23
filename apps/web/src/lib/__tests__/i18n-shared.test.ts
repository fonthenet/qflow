/**
 * Regression tests for lib/i18n/shared.ts — getFormattingLocale
 *
 * Covers the BCP-47 locale construction from language + country code.
 * getFormattingLocale is marked @deprecated but still used by i18n helpers
 * and must continue to work correctly.
 */

import { describe, expect, it } from 'vitest';
import { getFormattingLocale } from '@/lib/i18n/shared';

describe('getFormattingLocale', () => {
  it('returns ar-DZ for Arabic + Algeria', () => {
    expect(getFormattingLocale('ar', 'DZ')).toBe('ar-DZ');
  });

  it('returns fr-MA for French + Morocco', () => {
    expect(getFormattingLocale('fr', 'MA')).toBe('fr-MA');
  });

  it('returns en-US for English + US', () => {
    expect(getFormattingLocale('en', 'US')).toBe('en-US');
  });

  it('returns fr-DZ for French + Algeria', () => {
    expect(getFormattingLocale('fr', 'DZ')).toBe('fr-DZ');
  });

  it('returns ar-EG for Arabic + Egypt', () => {
    expect(getFormattingLocale('ar', 'EG')).toBe('ar-EG');
  });

  it('normalises lowercase country code to uppercase', () => {
    expect(getFormattingLocale('fr', 'dz')).toBe('fr-DZ');
    expect(getFormattingLocale('ar', 'ma')).toBe('ar-MA');
  });

  it('falls back to fr-FR when no country code is provided', () => {
    expect(getFormattingLocale('fr')).toBe('fr-FR');
    expect(getFormattingLocale('fr', null)).toBe('fr-FR');
    expect(getFormattingLocale('fr', undefined)).toBe('fr-FR');
  });

  it('falls back to ar (no region) when Arabic with no country code', () => {
    expect(getFormattingLocale('ar')).toBe('ar');
    expect(getFormattingLocale('ar', null)).toBe('ar');
  });

  it('falls back to en-US for English with no country code', () => {
    expect(getFormattingLocale('en')).toBe('en-US');
    expect(getFormattingLocale('en', undefined)).toBe('en-US');
  });

  it('returns en-NG for English + Nigeria', () => {
    expect(getFormattingLocale('en', 'NG')).toBe('en-NG');
  });
});
