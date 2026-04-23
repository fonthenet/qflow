/**
 * country.ts — shared helpers for reading country_config + verticals from Supabase.
 *
 * Design rules:
 * - Never hardcode DZ / Algeria / Africa/Algiers / DZD / +213 here.
 * - All formatting reads currency_decimals from the country config — never strips .00.
 * - Timezone falls back to UTC, not Africa/Algiers.
 * - Locale falls back to locale_default from country config, not fr-DZ.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Mirrors the country_config DB table.
 * Defined manually because the table was added via migration after the last
 * Supabase type generation run; update database.types.ts to remove this.
 */
export interface CountryConfigRow {
  code: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  currency_code: string;
  currency_symbol: string;
  currency_decimals: number;
  locale_default: string;
  locale_fallbacks: string[];
  timezone_default: string;
  phone_country_code: string;
  region: string;
  vat_rate_default: number | null;
  vat_label: string | null;
  payment_providers: string[];
  channel_providers: string[];
  feature_flags: Record<string, unknown>;
  created_at: string | null;
}

/** Strongly-typed feature flags decoded from the jsonb column. */
export interface CountryFeatureFlags {
  /** Wilaya picker (DZ-specific province selector). Only true for Algeria. */
  wilaya_picker?: boolean;
  /** Whether the country uses 24-hour clock convention. */
  hour12?: boolean;
  /**
   * cash_only: true means the country has no electronic payment providers
   * advertised to orgs. Checkout / deposit / no-show-fee UI must not render
   * any electronic payment option when this flag is set.
   *
   * Currently true for DZ (Algeria). Electronic provider stubs
   * (cib/edahabia/satim) remain registered in the payment registry but are
   * not advertised to DZ orgs. This flag will be cleared when DZ opens to
   * electronic payments.
   */
  cash_only?: boolean;
  /** Any other flags stored in the jsonb — kept as passthrough. */
  [key: string]: unknown;
}

export interface CountryConfig extends Omit<CountryConfigRow, 'feature_flags'> {
  feature_flags: CountryFeatureFlags;
}

/** Slim type that callers can pass down — only the fields formatMoney/formatDate need. */
export interface CountryConfigSlim {
  currency_code: string;
  currency_decimals: number;
  currency_symbol: string;
  timezone_default: string;
  locale_default: string;
  feature_flags: CountryFeatureFlags;
  phone_country_code: string;
  /** Present when the full country_config row is available. Used by isCashOnly(). */
  payment_providers?: string[];
}

/**
 * Mirrors the verticals DB table.
 * Defined manually because the table was added via migration after the last
 * Supabase type generation run; update database.types.ts to remove this.
 */
export interface VerticalsRow {
  slug: string;
  category: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  default_modules: string[];
  default_terminology: Record<string, unknown>;
  created_at: string | null;
}

// ── In-memory cache (module-level, server-side revalidation via Next.js) ──────

/** @internal exposed for country-hooks.ts only — do not import directly in app code */
export const _countryCache = new Map<string, CountryConfig>();
const _allCountriesCache: CountryConfig[] = [];
let _allCountriesFetched = false;

const _verticalCache = new Map<string, VerticalsRow>();
const _allVerticalsCache: VerticalsRow[] = [];
let _allVerticalsFetched = false;

// ── Country config fetchers ───────────────────────────────────────────────────

function parseCountryConfig(row: CountryConfigRow): CountryConfig {
  let feature_flags: CountryFeatureFlags = {};
  if (row.feature_flags && typeof row.feature_flags === 'object' && !Array.isArray(row.feature_flags)) {
    feature_flags = row.feature_flags as CountryFeatureFlags;
  }
  return { ...row, feature_flags };
}

/**
 * Fetch a single country_config by ISO-3166-1 alpha-2 code.
 * Results are cached in module memory for the lifetime of the server process.
 */
export async function getCountryConfig(
  supabase: SupabaseClient<Database>,
  code: string
): Promise<CountryConfig | null> {
  const upper = code.trim().toUpperCase();
  if (_countryCache.has(upper)) return _countryCache.get(upper)!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('country_config')
    .select('*')
    .eq('code', upper)
    .single();

  if (error || !data) return null;

  const parsed = parseCountryConfig(data);
  _countryCache.set(upper, parsed);
  return parsed;
}

/**
 * Fetch all 13 country_config rows.
 * Cached after the first call.
 */
export async function getAllCountryConfigs(
  supabase: SupabaseClient<Database>
): Promise<CountryConfig[]> {
  if (_allCountriesFetched) return _allCountriesCache;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('country_config')
    .select('*')
    .order('name_en');

  if (error || !data) return [];

  const parsed = data.map(parseCountryConfig);
  _allCountriesCache.push(...parsed);
  parsed.forEach((c: CountryConfig) => _countryCache.set(c.code, c));
  _allCountriesFetched = true;
  return parsed;
}

// ── Vertical fetchers ─────────────────────────────────────────────────────────

/**
 * Fetch a single vertical by slug.
 */
export async function getVertical(
  supabase: SupabaseClient<Database>,
  slug: string
): Promise<VerticalsRow | null> {
  if (_verticalCache.has(slug)) return _verticalCache.get(slug)!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('verticals')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  _verticalCache.set(slug, data);
  return data;
}

/**
 * Fetch all 15 vertical rows.
 */
export async function getAllVerticals(
  supabase: SupabaseClient<Database>
): Promise<VerticalsRow[]> {
  if (_allVerticalsFetched) return _allVerticalsCache;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('verticals')
    .select('*')
    .order('category')
    .order('name_en');

  if (error || !data) return [];

  _allVerticalsCache.push(...data);
  data.forEach((v: VerticalsRow) => _verticalCache.set(v.slug, v));
  _allVerticalsFetched = true;
  return data;
}

// ── Org-level helper (server actions / route handlers) ────────────────────────

/**
 * Fetch the country_config for an org's country.
 * Returns null when org has no country set or config not found.
 */
export async function getOrgCountryConfig(
  supabase: SupabaseClient<Database>,
  orgCountry: string | null | undefined
): Promise<CountryConfig | null> {
  if (!orgCountry) return null;
  return getCountryConfig(supabase, orgCountry);
}

// ── Pure formatting helpers ───────────────────────────────────────────────────

/**
 * Format a monetary amount using the country's currency settings.
 *
 * Rules (non-negotiable per project memory):
 * - Always uses currency_decimals from country config — never strips trailing zeros.
 * - DZD will always render with 2 decimal places ("1 234,00 DA").
 * - Respects the locale for number formatting (thousands/decimal separators).
 */
export function formatMoney(
  amount: number,
  countryConfig: Pick<CountryConfigSlim, 'currency_code' | 'currency_decimals' | 'locale_default'>,
  opts: { locale?: string } = {}
): string {
  const locale = opts.locale ?? countryConfig.locale_default;
  const { currency_code, currency_decimals } = countryConfig;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency_code,
      minimumFractionDigits: currency_decimals,
      maximumFractionDigits: currency_decimals,
    }).format(amount);
  } catch {
    // Fallback: manual formatting if currency code is unrecognised by Intl
    const fixed = amount.toFixed(currency_decimals);
    return `${fixed} ${currency_code}`;
  }
}

/**
 * Format a date using the country's default timezone and locale.
 * Org-level timezone overrides the country default when provided.
 */
export function formatDate(
  date: Date | string | number,
  countryConfig: Pick<CountryConfigSlim, 'timezone_default' | 'locale_default'>,
  opts: {
    locale?: string;
    timezone?: string; // org-level override
    dateStyle?: Intl.DateTimeFormatOptions['dateStyle'];
    timeStyle?: Intl.DateTimeFormatOptions['timeStyle'];
  } & Intl.DateTimeFormatOptions = {}
): string {
  const locale = opts.locale ?? countryConfig.locale_default;
  const timeZone = opts.timezone ?? countryConfig.timezone_default;
  const { locale: _l, timezone: _tz, ...intlOpts } = opts;

  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

  return dateObj.toLocaleDateString(locale, {
    timeZone,
    dateStyle: 'medium',
    ...intlOpts,
  });
}

/**
 * Check whether a feature flag is enabled for a country.
 * Reads from the feature_flags jsonb column.
 *
 * @example
 * hasFeature(countryConfig, 'wilaya_picker') // true for DZ only
 */
export function hasFeature(
  countryConfig: Pick<CountryConfigSlim, 'feature_flags'>,
  flag: keyof CountryFeatureFlags | string
): boolean {
  return Boolean(countryConfig.feature_flags?.[flag]);
}

/**
 * Return true when an org's country is operating in cash-only mode.
 *
 * A country is cash-only when either:
 *   1. The `cash_only` feature flag is explicitly set to true, OR
 *   2. The payment_providers array is empty (no providers configured).
 *
 * Both conditions are checked so the helper works even when:
 * - Only the DB migration ran (flag set, callers pass full CountryConfig).
 * - Only the seed was updated (empty array, flag not yet propagated to caller).
 *
 * When this returns true, callers must:
 * - NOT mount Stripe Elements or any other electronic payment widget.
 * - NOT call createCheckout / initiate a deposit or no-show-fee collection.
 * - Show a "Cash only" label instead of a payment UI.
 *
 * Currently true for DZ (Algeria) at launch. Electronic provider stubs
 * (cib/edahabia/satim) remain in the registry but are not advertised.
 */
export function isCashOnly(
  countryConfig: Pick<CountryConfigSlim, 'feature_flags'> & { payment_providers?: string[] }
): boolean {
  if (countryConfig.feature_flags?.cash_only === true) return true;
  if (Array.isArray(countryConfig.payment_providers) && countryConfig.payment_providers.length === 0) return true;
  return false;
}

/**
 * Resolve the effective timezone for an org/office.
 * Priority: org.timezone > countryConfig.timezone_default > 'UTC'
 *
 * Use this instead of hardcoding 'Africa/Algiers' as fallback.
 */
export function resolveTimezone(
  orgTimezone: string | null | undefined,
  countryConfig: Pick<CountryConfigSlim, 'timezone_default'> | null | undefined
): string {
  const raw = (orgTimezone ?? '').trim();
  if (raw) {
    // Normalise legacy alias
    return raw === 'Europe/Algiers' ? 'Africa/Algiers' : raw;
  }
  return countryConfig?.timezone_default ?? 'UTC';
}

/**
 * Resolve the effective locale for customer-facing text.
 * Priority: ticket.locale > org.locale_primary > countryConfig.locale_default > 'en'
 */
export function resolveLocale(
  ticketLocale: string | null | undefined,
  orgLocale: string | null | undefined,
  countryConfig: Pick<CountryConfigSlim, 'locale_default'> | null | undefined
): string {
  return (
    (ticketLocale ?? '').trim() ||
    (orgLocale ?? '').trim() ||
    countryConfig?.locale_default ||
    'en'
  );
}

/**
 * Build the BCP-47 formatting locale string for Intl APIs.
 * Derives region from country code so we get correct number/date formats.
 *
 * Replaces the hardcoded `getFormattingLocale` in i18n/shared.ts.
 */
export function buildFormattingLocale(
  locale: string,
  countryCode: string | null | undefined
): string {
  const code = (countryCode ?? '').trim().toUpperCase();
  if (!code) {
    if (locale.startsWith('fr')) return 'fr-FR';
    if (locale.startsWith('ar')) return 'ar';
    return 'en-US';
  }
  // BCP-47 region subtag: language-REGION
  const base = locale.split('-')[0];
  return `${base}-${code}`;
}

// ── React hooks ───────────────────────────────────────────────────────────────
// Hooks have been moved to country-hooks.ts (a 'use client' file).
// Import them from '@/lib/country-hooks' in Client Components only.
// Do NOT re-export them here — this file is imported by Server Components
// and a transitive import of useState/useEffect would break compilation.
