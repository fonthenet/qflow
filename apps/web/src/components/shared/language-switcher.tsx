'use client';

import { Languages } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n/messages';

const localeLabels: Record<AppLocale, string> = {
  en: 'EN',
  fr: 'FR',
  ar: 'AR',
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useI18n();

  function buildHref(nextLocale: AppLocale) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('lang', nextLocale);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 p-1 text-xs shadow-sm backdrop-blur">
      <span className="px-2 text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
      </span>
      {(['en', 'fr', 'ar'] as const).map((entry) => (
        <a
          key={entry}
          href={buildHref(entry)}
          className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${
            locale === entry ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {localeLabels[entry]}
        </a>
      ))}
    </div>
  );
}
