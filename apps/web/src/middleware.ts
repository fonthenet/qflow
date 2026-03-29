import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import {
  localeCookieName,
  localeHeaderName,
  supportedLocales,
  type AppLocale,
} from '@/lib/i18n/messages';
import { resolvePreferredLocale, resolveRegionalDefaultLocale } from '@/lib/i18n';

function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value && supportedLocales.includes(value as AppLocale));
}

export async function middleware(request: NextRequest) {
  const nextHeaders = new Headers(request.headers);
  const requestedLocale = request.nextUrl.searchParams.get('lang');
  const cookieLocale = request.cookies.get(localeCookieName)?.value;
  const locale =
    (isSupportedLocale(requestedLocale) ? requestedLocale : null) ??
    (isSupportedLocale(cookieLocale) ? cookieLocale : null) ??
    resolveRegionalDefaultLocale(
      request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry')
    ) ??
    resolvePreferredLocale(request.headers.get('accept-language'));

  nextHeaders.set(localeHeaderName, locale);

  const response = await updateSession(request, nextHeaders);

  if (cookieLocale !== locale) {
    response.cookies.set(localeCookieName, locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sounds|sw-notify\\.js|manifest\\.json|\\.well-known|station/assets|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css)$).*)',
  ],
};
