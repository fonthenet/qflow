import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { TranslationRuntime } from '@/components/providers/translation-runtime';
import { getServerI18n } from '@/lib/i18n';

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Qflo - Smart Queue Management',
  description: 'Modern queue and ticketing management system for businesses',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Qflo',
    startupImage: '/icon-512x512.png',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, countryCode, dir } = await getServerI18n();

  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen font-sans antialiased">
        <LocaleProvider locale={locale} countryCode={countryCode}>
          <TranslationRuntime />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
