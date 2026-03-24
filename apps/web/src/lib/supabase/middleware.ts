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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: requestHeaders ? { headers: requestHeaders } : request,
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
    '/login', '/register', '/history', '/api/',
    // Marketing & legal pages
    '/solutions', '/pricing', '/how-it-works', '/contact', '/docs',
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
    url.pathname = '/admin/offices';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
