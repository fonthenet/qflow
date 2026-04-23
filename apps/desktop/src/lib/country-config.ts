/**
 * country-config.ts — Renderer process module
 *
 * Provides typed access to country_config and verticals via IPC.
 * The actual data lives in SQLite (main process), synced from Supabase.
 *
 * All exported helpers return decoded TypeScript types — callers never
 * see raw JSON strings. The sync itself runs in the main process.
 */

// ── Decoded TypeScript types ──
// These mirror the Supabase schema but with arrays/jsonb already parsed.
// Do NOT import from Supabase generated types — we hand-roll these so
// the decoded shape is always correct regardless of Supabase client version.

export interface CountryConfig {
  code: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  currency_code: string;
  currency_symbol: string;
  /** Number of decimal digits to display for currency amounts (e.g. 2 for DZD) */
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
  synced_at: string | null;
}

export interface Vertical {
  slug: string;
  category: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  default_modules: string[];
  /** Map of term key → { en, fr, ar } translations */
  default_terminology: Record<string, Record<string, string>>;
  synced_at: string | null;
}

// ── IPC helpers ──
// Delegates all reads to main process via window.qf.countryConfig.*
// Never access SQLite directly from renderer.

/** Get a single country config by ISO 3166-1 alpha-2 code. Returns null if not found. */
export async function getCountryConfig(code: string): Promise<CountryConfig | null> {
  try {
    return await (window as any).qf.countryConfig.get(code);
  } catch { return null; }
}

/** Get all country configs, ordered by name_en. */
export async function getAllCountryConfigs(): Promise<CountryConfig[]> {
  try {
    return await (window as any).qf.countryConfig.getAll();
  } catch { return []; }
}

/** Get a single vertical by slug. Returns null if not found. */
export async function getVertical(slug: string): Promise<Vertical | null> {
  try {
    return await (window as any).qf.countryConfig.getVertical(slug);
  } catch { return null; }
}

/** Get all verticals, ordered by name_en. */
export async function getAllVerticals(): Promise<Vertical[]> {
  try {
    return await (window as any).qf.countryConfig.getAllVerticals();
  } catch { return []; }
}

/**
 * Get the country config for an organization, resolved via organizations.country.
 * Returns null if org has no country set or country not found in local cache.
 */
export async function getOrgCountryConfig(orgId: string): Promise<CountryConfig | null> {
  try {
    return await (window as any).qf.countryConfig.getOrgCountryConfig(orgId);
  } catch { return null; }
}

/**
 * Get the vertical for an organization, resolved via organizations.vertical.
 * Returns null if org has no vertical set or vertical not found in local cache.
 */
export async function getOrgVertical(orgId: string): Promise<Vertical | null> {
  try {
    return await (window as any).qf.countryConfig.getOrgVertical(orgId);
  } catch { return null; }
}

/**
 * Trigger a background sync of country_config + verticals from Supabase.
 * Non-blocking — returns immediately without waiting for sync to finish.
 * Call after auth is established (e.g. once per session startup).
 */
export function triggerCountryConfigSync(): void {
  try {
    (window as any).qf.countryConfig.sync().catch(() => {/* non-fatal */});
  } catch { /* non-fatal */ }
}
