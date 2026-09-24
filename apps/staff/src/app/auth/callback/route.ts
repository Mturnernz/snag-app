import { NextResponse, type NextRequest } from 'next/server';
import { createStaffClient } from '@/lib/supabase/staff';

/**
 * Where Google sends a staff member back to. PKCE, finished in the browser
 * that started it — the verifier is in the `/staff` cookie the sign-in button
 * set — which is exactly the case recovery links cannot rely on and this can.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createStaffClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/staff', request.url));
  }
  return NextResponse.redirect(new URL('/staff/sign-in?error=1', request.url));
}
