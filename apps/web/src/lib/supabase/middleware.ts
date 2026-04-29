import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest, requestHeaders?: Headers) {
  let supabaseResponse = NextResponse.next({
    request: requestHeaders ? { headers: requestHeaders } : request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          // Mutate the request cookie store so getAll() reflects the refreshed
          // token for any subsequent reads in this same middleware execution.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          // Rebuild the forwarded-request headers to include the refreshed
          // cookie values. This ensures Next.js server actions and server
          // components that run after the middleware receive a Cookie header
          // that matches the newly-issued session token, preventing a
          // getUser() mismatch that would cause a spurious 401 / redirect.
          const forwardHeaders = requestHeaders
            ? new Headers(requestHeaders)
            : new Headers(request.headers);

          // Re-serialise all cookies (original + refreshed) into Cookie header
          const cookieHeader = request.cookies.getAll()
            .map(({ name, value }) => `${name}=${value}`)
            .join('; ');
          forwardHeaders.set('cookie', cookieHeader);

          supabaseResponse = NextResponse.next({
            request: { headers: forwardHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes that don't need auth
  const publicPrefixes = [
    '/q/', '/ticket/', '/display/', '/d/', '/k/', '/kiosk/', '/join/', '/book/',
    // Rider portal: stateless HMAC-token in the URL grants the driver
    // GPS-streaming access to one specific delivery. Drivers don't have
    // Qflo accounts, so the route MUST be public — without this entry
    // the middleware redirected /rider/<ticketId>/<token> to /login.
    '/rider/',
    '/login', '/register', '/history', '/scan/', '/api/',
    // Marketing & legal pages
    '/solutions', '/pricing', '/how-it-works', '/contact', '/resources', '/docs',
    '/privacy', '/terms',
  ];

  const isPublicRoute =
    pathname === '/' ||
    publicPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    pathname.endsWith('/branches');

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = user.email === 'f.onthenet@gmail.com' ? '/super-admin' : '/admin/offices';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
