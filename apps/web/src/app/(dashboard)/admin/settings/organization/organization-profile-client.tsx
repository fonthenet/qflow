'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useI18n } from '@/components/providers/locale-provider';
import { updateOrganizationProfile } from '@/lib/actions/settings-actions';
import type { CountryConfig, VerticalsRow } from '@/lib/country';
import { isCashOnly } from '@/lib/country';

interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  vertical: string | null;
  locale_primary: string | null;
  timezone: string | null;
}

interface OrganizationProfileClientProps {
  organization: OrgProfile;
  countries: CountryConfig[];
  verticals: VerticalsRow[];
  /** Full IANA timezone list computed server-side — passed as prop to prevent
   *  hydration mismatches (Intl.supportedValuesOf can differ between Node ICU
   *  and the browser's built-in list). */
  timezones: string[];
}

/** Group verticals by category for the <select> optgroup layout. */
function groupVerticalsByCategory(verticals: VerticalsRow[]): Record<string, VerticalsRow[]> {
  const groups: Record<string, VerticalsRow[]> = {};
  for (const v of verticals) {
    if (!groups[v.category]) groups[v.category] = [];
    groups[v.category].push(v);
  }
  return groups;
}

/** Pick the vertical name in the current UI locale. */
function verticalName(v: VerticalsRow, locale: string): string {
  if (locale.startsWith('ar')) return v.name_ar ?? v.name_en;
  if (locale.startsWith('fr')) return v.name_fr ?? v.name_en;
  return v.name_en;
}

/** Pick the country name in the current UI locale. */
function countryName(c: CountryConfig, locale: string): string {
  if (locale.startsWith('ar')) return c.name_ar ?? c.name_en;
  if (locale.startsWith('fr')) return c.name_fr ?? c.name_en;
  return c.name_en;
}

/**
 * Map country_config.region to the leading IANA continent prefixes so we can
 * group "nearby" zones above the rest.  Unrecognised regions fall through to
 * the "other" bucket.
 */
const REGION_PREFIXES: Record<string, string[]> = {
  mena: ['Africa', 'Asia'],
  europe: ['Europe'],
  americas: ['America'],
  apac: ['Asia', 'Pacific', 'Australia'],
  africa: ['Africa'],
};

/** Compute the grouped/prioritised timezone option list for a given country.
 *  Accepts the full IANA list as a parameter so the caller controls the source
 *  (server-computed prop) and there is no Intl.supportedValuesOf call at
 *  render time — eliminating the SSR/CSR hydration mismatch. */
function buildTimezoneGroups(countryConfig: CountryConfig | null, allZones: string[]): {
  countryDefault: string | null;
  regional: string[];
  other: string[];
} {
  const countryDefault = countryConfig?.timezone_default ?? null;
  const prefixes = REGION_PREFIXES[countryConfig?.region ?? ''] ?? [];

  const regional: string[] = [];
  const other: string[] = [];

  for (const zone of allZones) {
    if (zone === countryDefault) continue; // will be shown first as explicit option
    const inRegion = prefixes.some((p) => zone.startsWith(p));
    if (inRegion) {
      regional.push(zone);
    } else {
      other.push(zone);
    }
  }

  return { countryDefault, regional, other };
}

const SELECT_STYLE: React.CSSProperties = {
  colorScheme: 'light',
  background: 'var(--color-background, #f4f6f9)',
  color: 'var(--color-foreground, #0a0a0a)',
  borderColor: 'var(--color-border, #e2e5eb)',
};

export function OrganizationProfileClient({
  organization,
  countries,
  verticals,
  timezones,
}: OrganizationProfileClientProps) {
  const { t, locale } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Inline hint shown when locale was auto-cleared because it's not valid for the new country. */
  const [localeResetHint, setLocaleResetHint] = useState(false);

  /** Build a code→config lookup once for the lifetime of this render. */
  const configsByCode = useMemo(
    () => new Map(countries.map((c) => [c.code, c])),
    [countries]
  );

  const [selectedCountry, setSelectedCountry] = useState(organization.country ?? '');
  const [selectedVertical, setSelectedVertical] = useState(organization.vertical ?? '');
  const [selectedLocale, setSelectedLocale] = useState(organization.locale_primary ?? '');

  /**
   * Timezone: pre-fill with country's default when the org has no saved timezone yet.
   * Lazy initializer so the Map lookup only runs once on mount.
   */
  const [selectedTimezone, setSelectedTimezone] = useState(() => {
    if (organization.timezone) return organization.timezone;
    const cfg = configsByCode.get(organization.country ?? '');
    return cfg?.timezone_default ?? '';
  });

  /** Tracks whether the user has explicitly chosen a timezone from the dropdown.
   *  false = auto-mode: country changes will update the timezone automatically.
   *  true  = user owns the value: country changes leave the timezone untouched.
   *  Picking the empty "Use country default" option resets this back to false. */
  const userPickedTz = useRef(false);

  // Derive the selected country config to show currency hint.
  const countryConfig = configsByCode.get(selectedCountry) ?? null;

  const verticalGroups = groupVerticalsByCategory(verticals);

  /** Memoised timezone groups — recomputed when the selected country or the
   *  timezones prop changes.  Uses the server-computed list to stay deterministic. */
  const timezoneGroups = useMemo(
    () => buildTimezoneGroups(countryConfig, timezones),
    [countryConfig, timezones]
  );

  /**
   * Auto-dismiss the locale-reset hint after 5 seconds.
   */
  useEffect(() => {
    if (!localeResetHint) return;
    const id = setTimeout(() => setLocaleResetHint(false), 5000);
    return () => clearTimeout(id);
  }, [localeResetHint]);

  function handleCountryChange(code: string) {
    const newConfig = configsByCode.get(code);

    setSelectedCountry(code);

    // ── Timezone: auto-update only when the user has NOT explicitly picked one ──
    if (!userPickedTz.current) {
      setSelectedTimezone(newConfig?.timezone_default ?? '');
    }

    // ── Locale: clear if the current locale is not valid for the new country ──
    if (selectedLocale) {
      const allowed: string[] = newConfig
        ? [newConfig.locale_default, ...(newConfig.locale_fallbacks ?? [])]
        : [];
      if (!allowed.includes(selectedLocale)) {
        setSelectedLocale('');
        setLocaleResetHint(true);
      }
    }
  }

  function handleTimezoneChange(zone: string) {
    // Empty string = user picked "Use country default" = resume auto mode.
    // Any actual zone = user owns the value from this point forward.
    userPickedTz.current = zone !== '';
    setSelectedTimezone(zone);
  }

  function handleSave() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateOrganizationProfile({
        country: selectedCountry || null,
        vertical: selectedVertical || null,
        locale_primary: selectedLocale || null,
        timezone: selectedTimezone || null,
      });
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(true);
      }
    });
  }

  /** Label for the "use country default" option, shows the actual TZ name when known. */
  const useCountryDefaultLabel = countryConfig?.timezone_default
    ? `${t('Use country default')} (${countryConfig.timezone_default})`
    : t('Use country default');

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
      {/* Country */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Country')} <span className="text-destructive">*</span>
        </label>
        <select
          value={selectedCountry}
          onChange={(e) => handleCountryChange(e.target.value)}
          style={SELECT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t('Select country')}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {countryName(c, locale)} — {c.currency_code}
            </option>
          ))}
        </select>
        {countryConfig && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('Currency')}: {countryConfig.currency_code} ({countryConfig.currency_symbol}) &middot;{' '}
            {t('Default timezone')}: {countryConfig.timezone_default} &middot;{' '}
            {t('Phone prefix')}: {countryConfig.phone_country_code}
            {isCashOnly(countryConfig) && (
              <>
                {' '}&middot;{' '}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 7px',
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--color-amber-100, #fef3c7)',
                    color: 'var(--color-amber-800, #92400e)',
                    border: '1px solid var(--color-amber-300, #fcd34d)',
                  }}
                >
                  {t('Cash-only region')}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Vertical */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Business Vertical')} <span className="text-destructive">*</span>
        </label>
        <select
          value={selectedVertical}
          onChange={(e) => setSelectedVertical(e.target.value)}
          style={SELECT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t('Select vertical')}</option>
          {Object.entries(verticalGroups).map(([category, verts]) => (
            <optgroup key={category} label={t(category.charAt(0).toUpperCase() + category.slice(1))}>
              {verts.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {verticalName(v, locale)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Primary locale */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Primary Locale')}
        </label>
        <select
          value={selectedLocale}
          onChange={(e) => { setSelectedLocale(e.target.value); setLocaleResetHint(false); }}
          style={SELECT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t('Use country default')}</option>
          <option value="fr">Français (FR)</option>
          <option value="ar">العربية (AR)</option>
          <option value="en">English (EN)</option>
          <option value="es">Español (ES)</option>
          <option value="de">Deutsch (DE)</option>
          <option value="pt">Português (PT)</option>
          <option value="hi">हिन्दी (HI)</option>
          <option value="id">Bahasa Indonesia (ID)</option>
        </select>
        {localeResetHint && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {t('Locale was reset — it is not supported in the selected country.')}
          </p>
        )}
      </div>

      {/* Timezone — native <select> grouped by: country default, regional, other */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Timezone')}
        </label>
        <select
          value={selectedTimezone}
          onChange={(e) => handleTimezoneChange(e.target.value)}
          style={SELECT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {/* Empty = use country default */}
          <option value="">{useCountryDefaultLabel}</option>

          {/* Country default zone as an explicit selectable entry */}
          {timezoneGroups.countryDefault && (
            <optgroup label={t('Country default')}>
              <option value={timezoneGroups.countryDefault}>
                {timezoneGroups.countryDefault}
              </option>
            </optgroup>
          )}

          {/* Regional zones (same continent/region as the selected country) */}
          {timezoneGroups.regional.length > 0 && (
            <optgroup label={t('Regional')}>
              {timezoneGroups.regional.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </optgroup>
          )}

          {/* All remaining zones */}
          {timezoneGroups.other.length > 0 && (
            <optgroup label={t('Other timezones')}>
              {timezoneGroups.other.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </optgroup>
          )}

          {/* Fallback when Intl.supportedValuesOf is not available (rare) */}
          {timezoneGroups.regional.length === 0 && timezoneGroups.other.length === 0 && !timezoneGroups.countryDefault && (
            <option value={selectedTimezone} disabled>
              {selectedTimezone || t('No timezone data available')}
            </option>
          )}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('Leave blank to use the country default timezone.')}
        </p>
      </div>

      {/* Feedback */}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {t('Organization profile saved.')}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {isPending ? t('Saving…') : t('Save Profile')}
        </button>
      </div>
    </div>
  );
}
