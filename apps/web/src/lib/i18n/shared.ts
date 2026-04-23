import {
  AppLocale,
  messages,
  rtlLocales,
  supportedLocales,
} from './messages';

export type TranslateParams = Record<string, string | number | null | undefined>;
export type CountryCode = string | null | undefined;

const translationCache: Record<AppLocale, Map<string, string>> = {
  en: new Map(),
  fr: new Map(),
  ar: new Map(),
  ja: new Map(),
  ko: new Map(),
  vi: new Map(),
};

const fragmentEntries = Object.fromEntries(
  supportedLocales.map((locale) => [
    locale,
    Object.entries(messages[locale])
      .filter(
        ([key, value]) =>
          key.length >= 4 &&
          key.length <= 120 &&
          !/[{}]/.test(key) &&
          /[A-Za-z]/.test(key) &&
          key !== value
      )
      .sort((left, right) => right[0].length - left[0].length),
  ])
) as Record<AppLocale, Array<[string, string]>>;

const dynamicTranslationRules: Record<
  AppLocale,
  Array<{ pattern: RegExp; replace: (...matches: string[]) => string }>
> = {
  en: [],
  fr: [
    { pattern: /^Updated (.+)$/u, replace: (_full, value) => `Mis a jour ${value}` },
    { pattern: /^Go to (.+)$/u, replace: (_full, value) => `Rendez-vous a ${value}` },
    { pattern: /^Return to (.+)$/u, replace: (_full, value) => `Retournez a ${value}` },
    { pattern: /^At (.+)$/u, replace: (_full, value) => `A ${value}` },
    { pattern: /^Now (.+)$/u, replace: (_full, value) => `En cours ${value}` },
    { pattern: /^#(\d+) in line$/u, replace: (_full, value) => `#${value} dans la file` },
    { pattern: /^~(\d+) min$/u, replace: (_full, value) => `~${value} min` },
    { pattern: /^(\d+) min$/u, replace: (_full, value) => `${value} min` },
    { pattern: /^(\d+)m$/u, replace: (_full, value) => `${value} min` },
    { pattern: /^(\d+) ahead of you$/u, replace: (_full, value) => `${value} devant vous` },
    {
      pattern: /^(\d+) out of 5 recorded$/u,
      replace: (_full, value) => `${value} sur 5 enregistre`,
    },
    { pattern: /^Recalled (\d+) times?$/u, replace: (_full, value) => `Rappele ${value} fois` },
  ],
  ar: [
    { pattern: /^Updated (.+)$/u, replace: (_full, value) => `تم التحديث ${value}` },
    { pattern: /^Go to (.+)$/u, replace: (_full, value) => `اذهب إلى ${value}` },
    { pattern: /^Return to (.+)$/u, replace: (_full, value) => `عد إلى ${value}` },
    { pattern: /^At (.+)$/u, replace: (_full, value) => `عند ${value}` },
    { pattern: /^Now (.+)$/u, replace: (_full, value) => `الآن ${value}` },
    { pattern: /^#(\d+) in line$/u, replace: (_full, value) => `#${value} في الطابور` },
    { pattern: /^~(\d+) min$/u, replace: (_full, value) => `~${value} دقيقة` },
    { pattern: /^(\d+) min$/u, replace: (_full, value) => `${value} دقيقة` },
    { pattern: /^(\d+)m$/u, replace: (_full, value) => `${value} دقيقة` },
    { pattern: /^(\d+) ahead of you$/u, replace: (_full, value) => `${value} أمامك` },
    {
      pattern: /^(\d+) out of 5 recorded$/u,
      replace: (_full, value) => `تم تسجيل ${value} من 5`,
    },
    {
      pattern: /^Recalled (\d+) times?$/u,
      replace: (_full, value) => `تمت إعادة النداء ${value} مرات`,
    },
  ],
  ja: [],
  ko: [],
  vi: [],
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;|&#38;/g, '&')
    .replace(/&lt;|&#60;/g, '<')
    .replace(/&gt;|&#62;/g, '>');
}

function normalizeTranslationKey(value: string) {
  return decodeHtmlEntities(value)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyDynamicTranslation(locale: AppLocale, value: string) {
  for (const rule of dynamicTranslationRules[locale]) {
    const match = value.match(rule.pattern);
    if (match) {
      return rule.replace(...match);
    }
  }
  return null;
}

function applyFragmentTranslations(locale: AppLocale, value: string) {
  let translated = value;

  for (const [source, target] of fragmentEntries[locale]) {
    if (!translated.includes(source)) continue;
    translated = translated.replace(new RegExp(escapeRegex(source), 'g'), target);
  }

  return translated;
}

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value && supportedLocales.includes(value as AppLocale));
}

export function getLocaleDirection(locale: AppLocale) {
  return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
}

export function resolvePreferredLocale(headerValue: string | null | undefined): AppLocale {
  if (!headerValue) return 'en';
  const normalized = headerValue.toLowerCase();
  if (normalized.includes('ar')) return 'ar';
  if (normalized.includes('fr')) return 'fr';
  return 'en';
}

export function resolveRegionalDefaultLocale(countryCode: string | null | undefined): AppLocale | null {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized) return null;
  const countryLocaleMap: Record<string, AppLocale> = {
    DZ: 'fr',
    MA: 'fr',
    TN: 'fr',
    SA: 'ar',
    AE: 'ar',
    EG: 'ar',
    IQ: 'ar',
    JO: 'ar',
    KW: 'ar',
    LB: 'ar',
    QA: 'ar',
    OM: 'ar',
    BH: 'ar',
    JP: 'ja',
    KR: 'ko',
    VN: 'vi',
  };
  return countryLocaleMap[normalized] ?? null;
}

export function normalizeCountryCode(countryCode: CountryCode) {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized || null;
}

export function isAlgeriaCountryCode(countryCode: CountryCode) {
  return normalizeCountryCode(countryCode) === 'DZ';
}

export function getFormattingLocale(locale: AppLocale, countryCode?: CountryCode) {
  const code = normalizeCountryCode(countryCode);
  if (code) {
    return `${locale}-${code}`;
  }

  if (locale === 'fr') return 'fr-FR';
  if (locale === 'ar') return 'ar';
  if (locale === 'ja') return 'ja-JP';
  if (locale === 'ko') return 'ko-KR';
  if (locale === 'vi') return 'vi-VN';
  return 'en-US';
}

function withRegionalDateTimeOptions(
  locale: AppLocale,
  countryCode: CountryCode,
  options?: Intl.DateTimeFormatOptions
) {
  const code = normalizeCountryCode(countryCode);
  const isMena = Boolean(
    code && ['DZ', 'MA', 'TN', 'EG', 'SA', 'AE', 'IQ', 'JO', 'KW', 'LB', 'QA', 'OM', 'BH'].includes(code)
  );
  const isEastAsia = locale === 'ja' || locale === 'ko' || locale === 'vi';
  if (!isMena && !isEastAsia) {
    return options ?? {};
  }

  const hasTime =
    options?.hour !== undefined ||
    options?.minute !== undefined ||
    options?.second !== undefined ||
    options?.timeStyle !== undefined;

  return {
    ...(options ?? {}),
    ...(hasTime ? { hour12: false } : {}),
  } satisfies Intl.DateTimeFormatOptions;
}

export function formatDateValue(
  value: Date | string | number,
  locale: AppLocale,
  countryCode?: CountryCode,
  options?: Intl.DateTimeFormatOptions
) {
  return new Date(value).toLocaleDateString(
    getFormattingLocale(locale, countryCode),
    withRegionalDateTimeOptions(locale, countryCode, options)
  );
}

export function formatTimeValue(
  value: Date | string | number,
  locale: AppLocale,
  countryCode?: CountryCode,
  options?: Intl.DateTimeFormatOptions
) {
  return new Date(value).toLocaleTimeString(
    getFormattingLocale(locale, countryCode),
    withRegionalDateTimeOptions(locale, countryCode, options)
  );
}

export function formatDateTimeValue(
  value: Date | string | number,
  locale: AppLocale,
  countryCode?: CountryCode,
  options?: Intl.DateTimeFormatOptions
) {
  return new Date(value).toLocaleString(
    getFormattingLocale(locale, countryCode),
    withRegionalDateTimeOptions(locale, countryCode, options)
  );
}

export function translate(locale: AppLocale, key: string, params?: TranslateParams) {
  const normalizedKey = normalizeTranslationKey(key);
  const cacheKey = params ? null : normalizedKey;

  if (cacheKey && translationCache[locale].has(cacheKey)) {
    return translationCache[locale].get(cacheKey)!;
  }

  let template =
    messages[locale][key] ??
    messages[locale][normalizedKey] ??
    applyDynamicTranslation(locale, normalizedKey) ??
    key;

  if (template === key && normalizedKey !== key) {
    const normalizedTemplate =
      messages[locale][normalizedKey] ??
      applyDynamicTranslation(locale, normalizedKey) ??
      normalizedKey;
    if (normalizedTemplate !== normalizedKey) {
      template = normalizedTemplate;
    }
  }

  if (template === key || template === normalizedKey) {
    const fragmentTemplate = applyFragmentTranslations(locale, normalizedKey);
    if (fragmentTemplate !== normalizedKey) {
      template = fragmentTemplate;
    }
  }

  if (!params) {
    if (cacheKey) {
      translationCache[locale].set(cacheKey, template);
    }
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value == null ? '' : String(value);
  });
}

export function createTranslator(locale: AppLocale) {
  return (key: string, params?: TranslateParams) => translate(locale, key, params);
}
