import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isMockAuth } from './lib/auth/mode';
import { decodeMockSession, MOCK_SESSION_COOKIE } from './lib/auth/session';

const PROTECTED_PREFIXES = ['/lists'];
const AUTH_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

function loginRedirect(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

/**
 * Next.js 16: Dateikonvention heisst `proxy.ts` (frueher `middleware.ts`).
 * Schuetzt /lists serverseitig, bevor die Route gerendert wird.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (isMockAuth()) {
    const session = decodeMockSession(request.cookies.get(MOCK_SESSION_COOKIE)?.value);
    if (isProtected && !session) return loginRedirect(request);
    if (isAuthRoute && session) {
      const url = request.nextUrl.clone();
      url.pathname = '/lists';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Konfiguration fehlt: nicht stillschweigend schuetzen, sondern sichtbar scheitern.
    return loginRedirect(request);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) return loginRedirect(request);
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/lists';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/lists/:path*', '/login', '/register', '/forgot-password', '/reset-password'],
};
