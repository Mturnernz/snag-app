import { NextResponse, type NextRequest } from 'next/server';
import { createStaffClient } from '@/lib/supabase';

/**
 * Where Google sends a staff member back to. PKCE, finished in the browser
 * that started it — the verifier is in the cookie the sign-in button set —
 * which is exactly the case a password-recovery link cannot rely on, and why
 * recovery lives on www.snaghq.co.nz with a client of its own.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createStaffClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.redirect(new URL('/sign-in?error=1', request.url));
}
