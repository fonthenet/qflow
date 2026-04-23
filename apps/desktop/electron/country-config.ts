/**
 * country-config.ts — Main process module
 *
 * Handles:
 *   1. Seeding country_config + verticals from bundled JSON on first launch.
 *   2. Syncing from Supabase (non-blocking, offline-first).
 *   3. Synchronous SQLite read helpers used by IPC handlers.
 *
 * NEVER import this from renderer code — it uses Node.js / better-sqlite3.
 * Renderer uses src/lib/country-config.ts (IPC wrapper).
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getDB } from './db';
import { logger } from './logger';
import { CONFIG } from './config';

// ── Types (decoded — same shape as renderer's CountryConfig / Vertical) ──

export interface CountryConfig {
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
  synced_at: string | null;
}

export interface Vertical {
  slug: string;
  category: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  default_modules: string[];
  default_terminology: Record<string, Record<string, string>>;
  synced_at: string | null;
}

// ── Raw SQLite row shapes (text columns stored as JSON strings) ──

interface CountryConfigRow {
  code: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  currency_code: string;
  currency_symbol: string;
  currency_decimals: number;
  locale_default: string;
  locale_fallbacks: string; // JSON text
  timezone_default: string;
  phone_country_code: string;
  region: string;
  vat_rate_default: number | null;
  vat_label: string | null;
  payment_providers: string; // JSON text
  channel_providers: string; // JSON text
  feature_flags: string; // JSON text
  synced_at: string | null;
}

interface VerticalRow {
  slug: string;
  category: string;
  name_en: string;
  name_fr: string;
  name_ar: string;
  default_modules: string; // JSON text
  default_terminology: string; // JSON text
  synced_at: string | null;
}

// ── JSON parsing helpers ──

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function decodeCountryRow(row: CountryConfigRow): CountryConfig {
  return {
    ...row,
    locale_fallbacks: parseJsonArray(row.locale_fallbacks),
    payment_providers: parseJsonArray(row.payment_providers),
    channel_providers: parseJsonArray(row.channel_providers),
    feature_flags: parseJsonObject(row.feature_flags),
  };
}

function decodeVerticalRow(row: VerticalRow): Vertical {
  return {
    ...row,
    default_modules: parseJsonArray(row.default_modules),
    default_terminology: parseJsonObject(row.default_terminology) as Record<string, Record<string, string>>,
  };
}

// ── Seed helpers ──
// Reads from bundled JSON in src/data/ (packaged into app resources by Vite/electron-builder)

function getSeedDir(): string {
  // Built main process lives in dist-electron/. The copySeedData Vite plugin
  // copies src/data/*.json → dist-electron/data/ at build time so the main
  // process can read them without touching the asar or process.resourcesPath.
  // In dev (vite-plugin-electron hot-reload), __dirname is also dist-electron/
  // because Vite re-transpiles in place.
  const candidates = [
    // Primary: dist-electron/data/ (copied by copySeedData Vite plugin)
    path.join(__dirname, 'data'),
    // Dev fallback: src/data/ relative to project root
    path.join(__dirname, '..', 'src', 'data'),
    // Packaged asar: resources/app/dist-electron/data/
    path.join(process.resourcesPath ?? '', 'app', 'dist-electron', 'data'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'country_config.seed.json'))) return dir;
  }
  // Last resort: return first candidate even if missing (error will surface clearly)
  return candidates[0];
}

function loadSeedJson<T>(filename: string): T[] {
  const dir = getSeedDir();
  const filepath = path.join(dir, filename);
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (err: any) {
    logger.warn('country-config', `Could not load seed file ${filename}`, { error: err?.message, tried: filepath });
    return [];
  }
}

// ── Seed on startup ──
// Runs INSERT OR REPLACE so the bundled defaults always fill empty tables
// but get overwritten by a subsequent Supabase sync with fresh data.

export function seedCountryConfig(): void {
  const db = getDB();

  // Check if tables are already seeded
  const countryCount = (db.prepare('SELECT COUNT(*) AS n FROM country_config').get() as any)?.n ?? 0;
  const verticalCount = (db.prepare('SELECT COUNT(*) AS n FROM verticals').get() as any)?.n ?? 0;

  if (countryCount === 0) {
    const rows = loadSeedJson<Record<string, unknown>>('country_config.seed.json');
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO country_config
        (code, name_en, name_fr, name_ar, currency_code, currency_symbol,
         currency_decimals, locale_default, locale_fallbacks, timezone_default,
         phone_country_code, region, vat_rate_default, vat_label,
         payment_providers, channel_providers, feature_flags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    for (const r of rows) {
      try {
        stmt.run(
          r.code,
          r.name_en,
          r.name_fr,
          r.name_ar,
          r.currency_code,
          r.currency_symbol,
          r.currency_decimals ?? 2,
          r.locale_default,
          JSON.stringify(r.locale_fallbacks ?? []),
          r.timezone_default,
          r.phone_country_code,
          r.region,
          r.vat_rate_default ?? null,
          r.vat_label ?? null,
          JSON.stringify(r.payment_providers ?? []),
          JSON.stringify(r.channel_providers ?? ['whatsapp', 'messenger']),
          JSON.stringify(r.feature_flags ?? {}),
        );
        inserted++;
      } catch (err: any) {
        logger.warn('country-config', `Failed to seed country row ${r.code}`, { error: err?.message });
      }
    }
    logger.info('country-config', `Seeded country_config`, { inserted, total: rows.length });
  }

  if (verticalCount === 0) {
    const rows = loadSeedJson<Record<string, unknown>>('verticals.seed.json');
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO verticals
        (slug, category, name_en, name_fr, name_ar, default_modules, default_terminology)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    for (const r of rows) {
      try {
        stmt.run(
          r.slug,
          r.category,
          r.name_en,
          r.name_fr,
          r.name_ar,
          JSON.stringify(r.default_modules ?? []),
          JSON.stringify(r.default_terminology ?? {}),
        );
        inserted++;
      } catch (err: any) {
        logger.warn('country-config', `Failed to seed vertical row ${r.slug}`, { error: err?.message });
      }
    }
    logger.info('country-config', `Seeded verticals`, { inserted, total: rows.length });
  }
}

// ── Supabase sync ──
// Non-blocking: called after auth is established. Falls back to local cache
// on any network/auth error (offline-first).

export async function syncCountryConfig(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string,
): Promise<void> {
  const db = getDB();
  const now = new Date().toISOString();
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Sync country_config
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/country_config?select=*`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const rows = await res.json() as Record<string, unknown>[];
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO country_config
          (code, name_en, name_fr, name_ar, currency_code, currency_symbol,
           currency_decimals, locale_default, locale_fallbacks, timezone_default,
           phone_country_code, region, vat_rate_default, vat_label,
           payment_providers, channel_providers, feature_flags, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of rows) {
        stmt.run(
          r.code,
          r.name_en,
          r.name_fr,
          r.name_ar,
          r.currency_code,
          r.currency_symbol,
          r.currency_decimals ?? 2,
          r.locale_default,
          typeof r.locale_fallbacks === 'string' ? r.locale_fallbacks : JSON.stringify(r.locale_fallbacks ?? []),
          r.timezone_default,
          r.phone_country_code,
          r.region,
          r.vat_rate_default ?? null,
          r.vat_label ?? null,
          typeof r.payment_providers === 'string' ? r.payment_providers : JSON.stringify(r.payment_providers ?? []),
          typeof r.channel_providers === 'string' ? r.channel_providers : JSON.stringify(r.channel_providers ?? ['whatsapp', 'messenger']),
          typeof r.feature_flags === 'string' ? r.feature_flags : JSON.stringify(r.feature_flags ?? {}),
          now,
        );
      }
      logger.info('country-config', `Synced country_config from Supabase`, { count: rows.length });
    } else {
      logger.warn('country-config', 'country_config sync failed', { status: res.status });
    }
  } catch (err: any) {
    logger.warn('country-config', 'country_config sync error (offline?)', { error: err?.message });
  }

  // Sync verticals
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/verticals?select=*`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const rows = await res.json() as Record<string, unknown>[];
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO verticals
          (slug, category, name_en, name_fr, name_ar, default_modules, default_terminology, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of rows) {
        stmt.run(
          r.slug,
          r.category,
          r.name_en,
          r.name_fr,
          r.name_ar,
          typeof r.default_modules === 'string' ? r.default_modules : JSON.stringify(r.default_modules ?? []),
          typeof r.default_terminology === 'string' ? r.default_terminology : JSON.stringify(r.default_terminology ?? {}),
          now,
        );
      }
      logger.info('country-config', `Synced verticals from Supabase`, { count: rows.length });
    } else {
      logger.warn('country-config', 'verticals sync failed', { status: res.status });
    }
  } catch (err: any) {
    logger.warn('country-config', 'verticals sync error (offline?)', { error: err?.message });
  }
}

// ── Synchronous read helpers (used by IPC handlers) ──

export function getCountryConfig(code: string): CountryConfig | null {
  try {
    const row = getDB()
      .prepare('SELECT * FROM country_config WHERE code = ? LIMIT 1')
      .get(code) as CountryConfigRow | undefined;
    return row ? decodeCountryRow(row) : null;
  } catch { return null; }
}

export function getAllCountryConfigs(): CountryConfig[] {
  try {
    const rows = getDB()
      .prepare('SELECT * FROM country_config ORDER BY name_en')
      .all() as CountryConfigRow[];
    return rows.map(decodeCountryRow);
  } catch { return []; }
}

export function getVertical(slug: string): Vertical | null {
  try {
    const row = getDB()
      .prepare('SELECT * FROM verticals WHERE slug = ? LIMIT 1')
      .get(slug) as VerticalRow | undefined;
    return row ? decodeVerticalRow(row) : null;
  } catch { return null; }
}

export function getAllVerticals(): Vertical[] {
  try {
    const rows = getDB()
      .prepare('SELECT * FROM verticals ORDER BY name_en')
      .all() as VerticalRow[];
    return rows.map(decodeVerticalRow);
  } catch { return []; }
}

export function getOrgCountryConfig(orgId: string): CountryConfig | null {
  try {
    const db = getDB();
    const org = db
      .prepare('SELECT country FROM organizations WHERE id = ? LIMIT 1')
      .get(orgId) as { country?: string } | undefined;
    if (!org?.country) return null;
    return getCountryConfig(org.country);
  } catch { return null; }
}

export function getOrgVertical(orgId: string): Vertical | null {
  try {
    const db = getDB();
    const org = db
      .prepare('SELECT vertical FROM organizations WHERE id = ? LIMIT 1')
      .get(orgId) as { vertical?: string } | undefined;
    if (!org?.vertical) return null;
    return getVertical(org.vertical);
  } catch { return null; }
}

// ── Upsert org cache row (called by sync engine when it fetches org data) ──

export function upsertOrganizationCache(org: {
  id: string;
  name?: string | null;
  name_ar?: string | null;
  logo_url?: string | null;
  settings?: Record<string, unknown> | string | null;
  timezone?: string | null;
  country?: string | null;
  vertical?: string | null;
  locale_primary?: string | null;
  locale_fallbacks?: string[] | string | null;
  currency_override?: string | null;
}): void {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    const settings =
      org.settings == null ? null
      : typeof org.settings === 'string' ? org.settings
      : JSON.stringify(org.settings);
    const localeFallbacks =
      org.locale_fallbacks == null ? null
      : Array.isArray(org.locale_fallbacks) ? JSON.stringify(org.locale_fallbacks)
      : org.locale_fallbacks;

    db.prepare(`
      INSERT OR REPLACE INTO organizations
        (id, name, name_ar, logo_url, settings, timezone, country, vertical,
         locale_primary, locale_fallbacks, currency_override, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      org.id,
      org.name ?? null,
      org.name_ar ?? null,
      org.logo_url ?? null,
      settings,
      org.timezone ?? null,
      org.country ?? null,
      org.vertical ?? null,
      org.locale_primary ?? null,
      localeFallbacks,
      org.currency_override ?? null,
      now,
    );
  } catch (err: any) {
    logger.warn('country-config', 'Failed to upsert organization cache', { orgId: org.id, error: err?.message });
  }
}
