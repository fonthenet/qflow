'use client';

import { ChevronDown } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n/messages';

const localeLabels: Record<AppLocale, string> = {
  en: 'EN',
  fr: 'FR',
  ar: 'AR',
};

export function LanguageSwitcher({ variant = 'floating' }: { variant?: 'floating' | 'embedded' }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function buildHref(nextLocale: AppLocale) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('lang', nextLocale);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const otherLocales = (['en', 'fr', 'ar'] as const).filter((entry) => entry !== locale);
  const buttonClassName =
    variant === 'embedded'
      ? 'inline-flex h-full min-h-[56px] items-center gap-1.5 rounded-[20px] border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white shadow-[0_36px_120px_rgba(2,6,23,0.35)] backdrop-blur transition-colors hover:bg-white/10'
      : 'inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background';
  const chevronClassName =
    variant === 'embedded'
      ? 'h-4 w-4 text-slate-300'
      : 'h-3.5 w-3.5 text-muted-foreground';
  const menuClassName =
    variant === 'embedded'
      ? 'absolute right-0 top-full z-50 mt-2 min-w-[84px] rounded-2xl border border-white/10 bg-slate-950/95 p-1 shadow-lg backdrop-blur'
      : 'absolute right-0 top-full z-50 mt-2 min-w-[72px] rounded-2xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur';
  const itemClassName =
    variant === 'embedded'
      ? 'block rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/8 hover:text-white'
      : 'block rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {localeLabels[locale]}
        <ChevronDown className={`${chevronClassName} transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <div className={menuClassName}>
          {otherLocales.map((entry) => (
            <a
              key={entry}
              href={buildHref(entry)}
              className={itemClassName}
              onClick={() => setIsOpen(false)}
            >
              {localeLabels[entry]}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
