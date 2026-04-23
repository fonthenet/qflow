'use client';

// TODO: Lawyer review required before public launch.
// This banner implements GDPR-compliant consent management.
// Verify that the categories and consent logic satisfy applicable DPA requirements
// (CNIL, ICO, etc.) before relying on this for regulatory compliance.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'qflo.cookie_consent';

export interface CookieConsent {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
}

function getStoredConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Basic shape validation
    if (typeof parsed.necessary !== 'undefined' && typeof parsed.timestamp === 'string') {
      return parsed as CookieConsent;
    }
    return null;
  } catch {
    return null;
  }
}

function saveConsent(analytics: boolean, marketing: boolean): CookieConsent {
  const consent: CookieConsent = {
    necessary: true,
    analytics,
    marketing,
    timestamp: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Storage unavailable — silently fail
  }
  return consent;
}

export function readCookieConsent(): CookieConsent | null {
  return getStoredConsent();
}

// Translations for the three supported locales.
const bannerText = {
  en: {
    title: 'Cookie preferences',
    body: 'We use cookies to provide essential features, measure performance, and improve your experience. You can choose which optional cookies to accept.',
    necessary: 'Necessary',
    necessaryDesc: 'Required for authentication, security, and core functionality. Cannot be disabled.',
    analytics: 'Analytics',
    analyticsDesc: 'Help us understand how the platform is used so we can improve it (Vercel Analytics).',
    marketing: 'Marketing',
    marketingDesc: 'No marketing cookies are currently in use.',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    savePreferences: 'Save preferences',
    learnMore: 'Privacy Policy',
  },
  fr: {
    title: 'Préférences cookies',
    body: 'Nous utilisons des cookies pour fournir des fonctionnalités essentielles, mesurer les performances et améliorer votre expérience. Vous pouvez choisir les cookies optionnels à accepter.',
    necessary: 'Nécessaires',
    necessaryDesc: 'Requis pour l\'authentification, la sécurité et les fonctionnalités de base. Ne peut pas être désactivé.',
    analytics: 'Analytiques',
    analyticsDesc: 'Nous aident à comprendre comment la plateforme est utilisée pour l\'améliorer (Vercel Analytics).',
    marketing: 'Marketing',
    marketingDesc: 'Aucun cookie marketing n\'est actuellement utilisé.',
    acceptAll: 'Tout accepter',
    rejectAll: 'Tout refuser',
    savePreferences: 'Enregistrer',
    learnMore: 'Politique de confidentialité',
  },
  ar: {
    title: 'تفضيلات ملفات تعريف الارتباط',
    body: 'نستخدم ملفات تعريف الارتباط لتوفير الميزات الأساسية وقياس الأداء وتحسين تجربتك. يمكنك اختيار ملفات تعريف الارتباط الاختيارية التي تقبلها.',
    necessary: 'ضرورية',
    necessaryDesc: 'مطلوبة للمصادقة والأمان والوظائف الأساسية. لا يمكن تعطيلها.',
    analytics: 'تحليلية',
    analyticsDesc: 'تساعدنا على فهم كيفية استخدام المنصة لتحسينها (Vercel Analytics).',
    marketing: 'تسويقية',
    marketingDesc: 'لا تُستخدم حاليًا أي ملفات تعريف ارتباط تسويقية.',
    acceptAll: 'قبول الكل',
    rejectAll: 'رفض الكل',
    savePreferences: 'حفظ التفضيلات',
    learnMore: 'سياسة الخصوصية',
  },
};

type SupportedLocale = keyof typeof bannerText;

function detectLocale(): SupportedLocale {
  if (typeof document === 'undefined') return 'en';
  const lang = document.documentElement.lang;
  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('ar')) return 'ar';
  return 'en';
}

interface CookieBannerProps {
  /** Force a specific locale instead of auto-detecting from the page lang attribute. */
  locale?: SupportedLocale;
  /**
   * Called when the user saves their preferences.
   * The parent (root layout) can use this to enable / disable analytics scripts.
   */
  onConsentChange?: (consent: CookieConsent) => void;
}

export function CookieBanner({ locale, onConsentChange }: CookieBannerProps) {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  // Marketing is always false (no marketing cookies in use) but the toggle is shown
  // for transparency and forward-compat.
  const [marketingEnabled, setMarketingEnabled] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>('en');

  useEffect(() => {
    const resolved = locale ?? detectLocale();
    setCurrentLocale(resolved);
    const stored = getStoredConsent();
    if (!stored) {
      setVisible(true);
    }
    // If consent already recorded, it is complete — do not show banner.
  }, [locale]);

  const handleAcceptAll = useCallback(() => {
    const consent = saveConsent(true, true);
    setVisible(false);
    onConsentChange?.(consent);
  }, [onConsentChange]);

  const handleRejectAll = useCallback(() => {
    const consent = saveConsent(false, false);
    setVisible(false);
    onConsentChange?.(consent);
  }, [onConsentChange]);

  const handleSavePreferences = useCallback(() => {
    const consent = saveConsent(analyticsEnabled, marketingEnabled);
    setVisible(false);
    onConsentChange?.(consent);
  }, [analyticsEnabled, marketingEnabled, onConsentChange]);

  if (!visible) return null;

  const t = bannerText[currentLocale];
  const isRTL = currentLocale === 'ar';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      dir={isRTL ? 'rtl' : 'ltr'}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background shadow-lg"
      style={{ colorScheme: 'light dark' }}
    >
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: text */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground">{t.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.body}</p>
            {showDetails && (
              <div className="mt-3 space-y-3">
                {/* Necessary */}
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-4 w-8 flex-shrink-0 items-center rounded-full bg-primary opacity-60" aria-label="Always on" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.necessary}</p>
                    <p className="text-xs text-muted-foreground">{t.necessaryDesc}</p>
                  </div>
                </div>

                {/* Analytics */}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={analyticsEnabled}
                    onClick={() => setAnalyticsEnabled((v) => !v)}
                    className={[
                      'mt-0.5 flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                      analyticsEnabled ? 'bg-primary' : 'bg-muted',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        analyticsEnabled ? (isRTL ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.analytics}</p>
                    <p className="text-xs text-muted-foreground">{t.analyticsDesc}</p>
                  </div>
                </div>

                {/* Marketing */}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={marketingEnabled}
                    onClick={() => setMarketingEnabled((v) => !v)}
                    className={[
                      'mt-0.5 flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                      marketingEnabled ? 'bg-primary' : 'bg-muted',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        marketingEnabled ? (isRTL ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.marketing}</p>
                    <p className="text-xs text-muted-foreground">{t.marketingDesc}</p>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleSavePreferences}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    {t.savePreferences}
                  </button>
                </div>
              </div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                {showDetails ? (currentLocale === 'ar' ? 'إخفاء التفاصيل' : currentLocale === 'fr' ? 'Masquer les détails' : 'Hide details') : (currentLocale === 'ar' ? 'إدارة التفضيلات' : currentLocale === 'fr' ? 'Gérer les préférences' : 'Manage preferences')}
              </button>
              <span className="text-muted-foreground">·</span>
              <Link href="/privacy" className="text-xs text-muted-foreground underline hover:text-foreground">
                {t.learnMore}
              </Link>
            </div>
          </div>

          {/* Right: action buttons — reject-all visually equal to accept-all per CNIL/ICO */}
          <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleRejectAll}
              className="rounded-md border border-border bg-background px-5 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {t.rejectAll}
            </button>
            <button
              type="button"
              onClick={handleAcceptAll}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {t.acceptAll}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Re-opens the cookie banner by clearing stored consent.
 * Use this for a "Cookie preferences" footer link.
 */
export function reopenCookieBanner() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Trigger a page reload so the banner re-mounts from fresh state.
    window.location.reload();
  } catch {
    // no-op
  }
}
