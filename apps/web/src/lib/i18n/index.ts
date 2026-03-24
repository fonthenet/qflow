import { cookies, headers } from 'next/headers';
import {
  AppLocale,
  localeCookieName,
  localeHeaderName,
} from './messages';
import {
  createTranslator,
  normalizeCountryCode,
  formatDateTimeValue,
  formatDateValue,
  formatTimeValue,
  getLocaleDirection,
  isSupportedLocale,
  resolveRegionalDefaultLocale,
  resolvePreferredLocale,
} from './shared';

export {
  createTranslator,
  formatDateTimeValue,
  formatDateValue,
  formatTimeValue,
  getLocaleDirection,
  getFormattingLocale,
  isAlgeriaCountryCode,
  normalizeCountryCode,
  resolvePreferredLocale,
  resolveRegionalDefaultLocale,
  translate,
} from './shared';
export type { TranslateParams } from './shared';
export type { AppLocale } from './messages';

export async function getRequestLocale(): Promise<AppLocale> {
  const headerStore = await headers();
  const requestLocale = headerStore.get(localeHeaderName);
  if (isSupportedLocale(requestLocale)) {
    return requestLocale;
  }

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(localeCookieName)?.value;
  if (isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  return (
    resolveRegionalDefaultLocale(
      headerStore.get('x-vercel-ip-country') ?? headerStore.get('cf-ipcountry')
    ) ?? resolvePreferredLocale(headerStore.get('accept-language'))
  );
}

export async function getServerI18n() {
  const headerStore = await headers();
  const locale = await getRequestLocale();
  const countryCode = normalizeCountryCode(
    headerStore.get('x-vercel-ip-country') ?? headerStore.get('cf-ipcountry')
  );
  return {
    locale,
    countryCode,
    dir: getLocaleDirection(locale),
    t: createTranslator(locale),
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateValue(value, locale, countryCode, options),
    formatTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatTimeValue(value, locale, countryCode, options),
    formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateTimeValue(value, locale, countryCode, options),
  };
}
