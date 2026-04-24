'use client';

import { useMemo, useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { register } from '@/lib/actions/auth-actions';
import { useI18n } from '@/components/providers/locale-provider';

function SubmitButton() {
  const { pending } = useFormStatus();
  const { t } = useI18n();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
    >
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? t('Creating account...') : t('Create Account')}
    </button>
  );
}
import {
  COUNTRIES,
  DEFAULT_TIMEZONE,
  detectDefaultCountry,
  getCountry,
  resolveLocalized,
  type CategoryLocale,
} from '@qflo/shared';

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  const wizardLocale: CategoryLocale =
    locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr';

  // Guess country from browser timezone on first render so most users
  // don't have to touch the selector.
  const detected = useMemo(() => detectDefaultCountry(), []);
  const [countryCode, setCountryCode] = useState<string>(detected?.code ?? 'DZ');
  const [cityName, setCityName] = useState<string>('');

  const selectedCountry = useMemo(() => getCountry(countryCode), [countryCode]);
  const selectedCity = useMemo(
    () =>
      selectedCountry?.cities.find(
        (c) => resolveLocalized(c.name, wizardLocale) === cityName,
      ) ?? null,
    [selectedCountry, cityName, wizardLocale],
  );
  const timezone =
    selectedCity?.timezone ?? selectedCountry?.defaultTimezone ?? DEFAULT_TIMEZONE;

  // Reset city whenever the country changes.
  useEffect(() => {
    setCityName('');
  }, [countryCode]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    // Inline validation — avoids Chromium's dark native "Please fill out
    // this field" bubble which can't be CSS-styled to match our light UI.
    const organizationName = (formData.get('organizationName') as string | null)?.trim() ?? '';
    const fullName = (formData.get('fullName') as string | null)?.trim() ?? '';
    const email = (formData.get('email') as string | null)?.trim() ?? '';
    const password = (formData.get('password') as string | null) ?? '';
    if (!organizationName) return setError(t('Business name is required.'));
    if (!fullName) return setError(t('Your full name is required.'));
    if (!email) return setError(t('Email is required.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError(t('Enter a valid email address.'));
    if (password.length < 6) return setError(t('Password must be at least 6 characters.'));
    if (!countryCode) return setError(t('Please select a country.'));

    // Ensure our controlled values win over any stale DOM defaults.
    formData.set('country', countryCode);
    formData.set('city', cityName);
    formData.set('locale', wizardLocale);
    const result = await register(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 px-4 py-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">
            Q<span className="text-primary">flo</span>
          </h1>
          <p className="mt-2 text-muted-foreground">{t('Register your business')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <form action={handleSubmit} noValidate className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="organizationName" className="text-sm font-medium">
                {t('Business Name')}
              </label>
              <input
                id="organizationName"
                name="organizationName"
                type="text"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t('City Hospital, Post Office...')}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="fullName" className="text-sm font-medium">
                {t('Your Full Name')}
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t('John Doe')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label htmlFor="country" className="text-sm font-medium">
                  {t('Country')}
                </label>
                <select
                  id="country"
                  name="country"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  style={{ colorScheme: 'light' }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {resolveLocalized(c.name, wizardLocale)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="city" className="text-sm font-medium">
                  {t('City')}
                </label>
                <select
                  id="city"
                  name="city"
                  value={cityName}
                  onChange={(e) => setCityName(e.target.value)}
                  style={{ colorScheme: 'light' }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {(selectedCountry?.cities ?? []).map((c) => {
                    const name = resolveLocalized(c.name, wizardLocale);
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">
              {t('Timezone')}:{' '}
              <code className="font-mono text-xs">{timezone}</code>
            </p>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t('Email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="admin@company.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('Password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t('Minimum 6 characters')}
              />
            </div>

            <SubmitButton />
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('Already have an account?')}{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t('Sign In')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
