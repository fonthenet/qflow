'use client';

// Mounts Vercel Analytics and SpeedInsights only when the user has consented
// to analytics cookies (qflo.cookie_consent.analytics === true).
// If no consent is stored yet, we skip analytics until the user decides.

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { CookieBanner, readCookieConsent, type CookieConsent } from './CookieBanner';

export function ConsentAwareAnalytics() {
  const [consent, setConsent] = useState<CookieConsent | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Read once on mount — if already stored, analytics load immediately.
    const stored = readCookieConsent();
    setConsent(stored);
    setChecked(true);
  }, []);

  function handleConsentChange(c: CookieConsent) {
    setConsent(c);
  }

  if (!checked) {
    // SSR / before hydration: render neither analytics nor banner.
    return null;
  }

  const analyticsAllowed = consent?.analytics === true;

  return (
    <>
      {/* Cookie banner — shown only when no consent is stored yet */}
      <CookieBanner onConsentChange={handleConsentChange} />

      {/* Analytics — gated on analytics consent */}
      {analyticsAllowed && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </>
  );
}
