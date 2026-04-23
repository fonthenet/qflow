/**
 * Provider registry — the single source of truth for which payment providers
 * are registered at runtime.
 *
 * Registration happens as a side-effect of importing a provider module.
 * All callers should import from `lib/payments/index.ts` which does the
 * side-effect imports for every provider automatically.
 *
 * Country advertised status:
 * - DZ is currently cash-only; electronic provider stubs (cib/edahabia/satim)
 *   remain registered here but are not advertised to DZ orgs (payment_providers
 *   is an empty array in country_config for DZ). Callers must check
 *   isCashOnly(countryConfig) from lib/country.ts before initiating any
 *   electronic payment flow.
 */

import type { PaymentProvider } from './provider';

// ── Internal store ────────────────────────────────────────────────────────────

const _registry = new Map<string, PaymentProvider>();

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a payment provider.
 * Safe to call multiple times with the same id — second call is a no-op
 * (prevents double-registration from hot-reload).
 */
export function registerProvider(provider: PaymentProvider): void {
  if (_registry.has(provider.id)) return;
  _registry.set(provider.id, provider);
}

// ── Lookup ────────────────────────────────────────────────────────────────────

/**
 * Retrieve a registered provider by its id.
 * Returns null when the provider is not registered (e.g. not installed yet).
 */
export function getProvider(id: string): PaymentProvider | null {
  return _registry.get(id) ?? null;
}

/**
 * Return all registered providers that support the given country code.
 *
 * The order of results follows the order of `providerIds` (which should come
 * from country_config.payment_providers — the ordered preference list).
 *
 * Providers registered in the registry but absent from providerIds are
 * excluded, so UI only shows country-relevant options.
 */
export function getProvidersForCountry(
  countryCode: string,
  /** Ordered array from country_config.payment_providers */
  providerIds?: string[]
): PaymentProvider[] {
  const upper = countryCode.toUpperCase();

  // An explicitly supplied empty array means "cash-only — no providers".
  // Return [] immediately; do NOT fall through to the scan.
  if (providerIds !== undefined) {
    if (providerIds.length === 0) return [];
    // Respect the order defined in country_config.payment_providers
    return providerIds
      .map((id) => _registry.get(id))
      .filter((p): p is PaymentProvider => p !== undefined && p.supportedCountries.includes(upper));
  }

  // Fallback: scan all registered providers (used when caller has no
  // country_config row available, e.g. registry-only tests).
  return Array.from(_registry.values()).filter((p) =>
    p.supportedCountries.includes(upper)
  );
}

/**
 * Return the first registered provider for a country, following the ordered
 * preference list from country_config.payment_providers.
 *
 * Returns null when no matching provider is registered.
 */
export function getDefaultProviderForCountry(
  countryCode: string,
  providerIds?: string[]
): PaymentProvider | null {
  const providers = getProvidersForCountry(countryCode, providerIds);
  return providers[0] ?? null;
}

/**
 * Return only providers with `isImplemented = true` for a country.
 *
 * Production code paths that initiate checkouts MUST use this helper instead
 * of getDefaultProviderForCountry / getProvidersForCountry. Stub providers
 * (isImplemented = false) throw NotImplementedError from createCheckout —
 * this guard prevents that from ever reaching production callers.
 *
 * The order follows providerIds when supplied (country_config preference list).
 */
export function getImplementedProvidersForCountry(
  countryCode: string,
  providerIds?: string[]
): PaymentProvider[] {
  return getProvidersForCountry(countryCode, providerIds).filter((p) => p.isImplemented);
}

/**
 * Return the first *implemented* provider for a country.
 *
 * Returns null when no implemented provider is registered for that country.
 * Prefer this over getDefaultProviderForCountry in production checkout paths.
 */
export function getImplementedProviderForCountry(
  countryCode: string,
  providerIds?: string[]
): PaymentProvider | null {
  return getImplementedProvidersForCountry(countryCode, providerIds)[0] ?? null;
}

/**
 * List all registered provider ids (useful for debugging / admin UI).
 */
export function listRegisteredProviders(): string[] {
  return Array.from(_registry.keys());
}
