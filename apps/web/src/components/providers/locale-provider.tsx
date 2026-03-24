'use client';

import { createContext, useContext } from 'react';
import { AppLocale } from '@/lib/i18n/messages';
import {
  CountryCode,
  createTranslator,
  formatDateTimeValue,
  formatDateValue,
  formatTimeValue,
  getLocaleDirection,
} from '@/lib/i18n/shared';

interface LocaleContextValue {
  locale: AppLocale;
  countryCode: CountryCode;
  dir: 'ltr' | 'rtl';
  t: ReturnType<typeof createTranslator>;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  countryCode,
  children,
}: {
  locale: AppLocale;
  countryCode?: CountryCode;
  children: React.ReactNode;
}) {
  const value: LocaleContextValue = {
    locale,
    countryCode,
    dir: getLocaleDirection(locale),
    t: createTranslator(locale),
    formatDate: (value, options) => formatDateValue(value, locale, countryCode, options),
    formatTime: (value, options) => formatTimeValue(value, locale, countryCode, options),
    formatDateTime: (value, options) => formatDateTimeValue(value, locale, countryCode, options),
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useI18n must be used inside LocaleProvider');
  }
  return context;
}
