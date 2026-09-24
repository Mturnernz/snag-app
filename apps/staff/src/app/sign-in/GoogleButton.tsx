'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '@/components/Button';

/**
 * Google Workspace sign-in. `hd` asks Google to offer snaghq.co.nz accounts
 * first; it is a hint, not a check — the check is `home.is_staff()`, which
 * wants a staff row, the matching Google-verified address and a Google login.
 */
export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions: { path: '/staff', sameSite: 'lax' } }
    );
    const { error: failed } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/staff/auth/callback`,
        queryParams: { hd: 'snaghq.co.nz', prompt: 'select_account' },
      },
    });
    // On success the browser is already on its way to Google.
    if (failed) {
      setError(failed.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={signIn} disabled={busy}>
        {busy ? 'Opening Google…' : 'Sign in with Google'}
      </Button>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </>
  );
}
