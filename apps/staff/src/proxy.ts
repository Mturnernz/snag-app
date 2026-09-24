import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Keeps a staff session fresh, and sends anybody without one to sign in.
 *
 * Only `/staff` runs through here: the root page and password recovery have no
 * session and must not grow one. This is not the security boundary — every
 * portal read and write goes through a `staff_*` function that refuses a caller
 * not on the staff list — it is what refreshes the cookie and saves a signed-out
 * visitor a page that can only say no.
 */
const OPEN = ['/staff/sign-in', '/staff/auth/'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: { path: '/staff', sameSite: 'lax' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Validates the token rather than trusting the cookie's contents.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const open = OPEN.some((p) => path === p || path.startsWith(p));

  if (!data?.claims && !open) {
    const to = request.nextUrl.clone();
    to.pathname = '/staff/sign-in';
    to.search = '';
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  // `:path*` matches zero segments too, so this covers /staff itself.
  matcher: ['/staff/:path*'],
};
