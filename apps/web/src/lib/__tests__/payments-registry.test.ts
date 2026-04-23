/**
 * Regression tests for lib/payments/registry.ts + index.ts
 *
 * Covers:
 * - getProvidersForCountry('DZ', []) returns [] — DZ is cash-only (empty provider list)
 * - getImplementedProviderForCountry('DZ', []) returns null — no provider for DZ
 * - getProvidersForCountry('DZ') without providerIds returns DZ stubs (registry scan)
 * - getDefaultProviderForCountry('FR') → stripe
 * - getProvider('stripe').isImplemented → true
 * - getProvider('cib').isImplemented → false (stub, not advertised to DZ)
 *
 * No network, no Supabase — pure registry queries.
 *
 * IMPORTANT: index.ts performs side-effect registrations.
 * Importing it is sufficient to populate the registry for all tests.
 *
 * DZ cash-only policy (as of 2026-04-24):
 * - country_config.payment_providers = [] for DZ.
 * - Passing the empty array is the authoritative signal for callers.
 * - Provider stubs (cib/edahabia/satim) remain registered for future use.
 */

import { describe, expect, it } from 'vitest';

// Bootstrap all providers via side-effect imports
import '@/lib/payments/index';

import {
  getProvider,
  getProvidersForCountry,
  getDefaultProviderForCountry,
  getImplementedProviderForCountry,
} from '@/lib/payments/registry';

// DZ cash-only: country_config.payment_providers is now []
const DZ_PROVIDER_IDS_CASH_ONLY: string[] = [];

// Kept for verifying stubs are still registered (non-advertised)
const DZ_LEGACY_PROVIDER_IDS = ['cib', 'edahabia', 'satim', 'stripe'];

describe('getProvidersForCountry — DZ cash-only', () => {
  it('returns [] when providerIds is an empty array (DZ cash-only — post-migration)', () => {
    const providers = getProvidersForCountry('DZ', DZ_PROVIDER_IDS_CASH_ONLY);
    expect(providers).toEqual([]);
  });

  it('returns DZ stubs via fallback scan when no providerIds supplied (registry always has them)', () => {
    // The stubs are still registered — this is correct; the cash-only gate is
    // enforced at the providerIds level (country_config), not the registry level.
    const providers = getProvidersForCountry('DZ');
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('cib');
    expect(ids).toContain('edahabia');
    expect(ids).toContain('satim');
  });

  it('all DZ stubs still have DZ in their supportedCountries (stubs remain registered)', () => {
    const providers = getProvidersForCountry('DZ', DZ_LEGACY_PROVIDER_IDS);
    providers.forEach((p) => {
      expect(p.supportedCountries).toContain('DZ');
    });
  });

  it('returns stripe for FR when no providerIds given', () => {
    const providers = getProvidersForCountry('FR');
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('stripe');
  });
});

describe('getImplementedProviderForCountry — DZ cash-only', () => {
  it('returns null for DZ with empty providerIds (cash-only, no implemented provider)', () => {
    const provider = getImplementedProviderForCountry('DZ', DZ_PROVIDER_IDS_CASH_ONLY);
    expect(provider).toBeNull();
  });

  it('returns stripe for FR as implemented provider', () => {
    const provider = getImplementedProviderForCountry('FR', ['stripe']);
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe('stripe');
  });
});

describe('getDefaultProviderForCountry', () => {
  it('returns null for DZ with empty providerIds (cash-only)', () => {
    const provider = getDefaultProviderForCountry('DZ', DZ_PROVIDER_IDS_CASH_ONLY);
    expect(provider).toBeNull();
  });

  it('returns stripe as the default FR provider', () => {
    const provider = getDefaultProviderForCountry('FR', ['stripe', 'paypal']);
    expect(provider?.id).toBe('stripe');
  });

  it('returns null for an unknown country with no matching providers', () => {
    const provider = getDefaultProviderForCountry('ZZ', ['does-not-exist']);
    expect(provider).toBeNull();
  });
});

describe('getProvider — individual providers (stubs still registered)', () => {
  it('stripe: isImplemented is true', () => {
    const p = getProvider('stripe');
    expect(p).not.toBeNull();
    expect(p?.isImplemented).toBe(true);
  });

  it('cib: isImplemented is false (stub — not advertised to DZ, kept for future)', () => {
    const p = getProvider('cib');
    expect(p).not.toBeNull();
    expect(p?.isImplemented).toBe(false);
  });

  it('edahabia: isImplemented is false (stub — not advertised to DZ)', () => {
    const p = getProvider('edahabia');
    expect(p).not.toBeNull();
    expect(p?.isImplemented).toBe(false);
  });

  it('satim: isImplemented is false (stub — not advertised to DZ)', () => {
    const p = getProvider('satim');
    expect(p).not.toBeNull();
    expect(p?.isImplemented).toBe(false);
  });

  it('returns null for an unregistered provider id', () => {
    expect(getProvider('not-a-provider')).toBeNull();
  });

  it('stripe: DZD is NOT in supportedCurrencies (Stripe does not process DZD)', () => {
    const stripe = getProvider('stripe');
    expect(stripe?.supportedCurrencies).not.toContain('DZD');
  });

  it('cib: DZD IS in supportedCurrencies (would be used if DZ re-enables electronic payments)', () => {
    const cib = getProvider('cib');
    expect(cib?.supportedCurrencies).toContain('DZD');
  });
});
