'use server';

import { createClient as createPlainClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { SITE_URL } from '@/lib/seo';

/**
 * Sends the recovery email — deliberately NOT through `@/lib/supabase/server`.
 *
 * `@supabase/ssr` forces `flowType: 'pkce'` on both its clients, and a PKCE
 * recovery link only works in the browser that asked for it: auth-js's
 * `_isPKCECallback` requires the `code` in the URL *and* a stored code
 * verifier, and when the verifier is missing it returns false, so the link is
 * not recognised as a callback at all. Nothing happens and nothing is said.
 *
 * Requesting a reset on a laptop and opening the mail on a phone is the normal
 * case, not the edge case — and the SNAG app's own "Forgot password?" hands off
 * to this page from a completely different origin, so the verifier could never
 * be there. A plain client on the implicit flow sends no code challenge, which
 * makes the link a fragment-token one that any browser can complete.
 */
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent('Enter your email address.')}`);
  }

  const supabase = createPlainClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false } },
  );

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('/reset-password', SITE_URL).toString(),
  });

  // The same answer either way. Telling someone "no account with that email"
  // turns this form into a way to find out who has an account here, and the
  // people asking that question are not the ones who forgot their password.
  redirect('/forgot-password?sent=1');
}
