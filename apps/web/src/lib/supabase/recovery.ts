import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The client for the password-recovery landing page — deliberately NOT
 * `createBrowserClient` from `@supabase/ssr`.
 *
 * `createBrowserClient` hardcodes `flowType: 'pkce'` with no way to override
 * it, and a recovery link from `forgot-password/actions.ts` arrives on the
 * *implicit* flow, with its tokens in the URL fragment. auth-js notices the
 * mismatch and refuses:
 *
 *   _initialize()        → sees `access_token` in the fragment, so
 *                          callbackUrlType = 'implicit'
 *   _getSessionFromURL() → `case 'implicit': if (this.flowType === 'pkce')
 *                          throw new AuthPKCEGrantCodeExchangeError(...)`
 *
 * The throw happens inside `_initialize`, so nothing rejects where the page
 * could see it — `getSession()` simply resolves null, and a landing page that
 * reads that as "no token" tells the person their link expired. It had in fact
 * just been verified successfully by the server seconds earlier. That is the
 * whole failure: `GET /verify` returns 303 and the page still says expired.
 *
 * Worth knowing that `_isImplicitGrantCallback` really does fire regardless of
 * the configured flow type — the guard that kills this is three functions
 * further on, which is what makes the wrong client look like it should work.
 *
 * `persistSession: false` keeps a recovery session out of storage entirely; it
 * is needed for exactly one `updateUser` call. But note what that implies:
 * with no persistence auth-js falls back to an in-memory storage adapter, so
 * **the session exists only inside this one client instance**. Whoever calls
 * this must hold onto the instance and use it for the update too — building a
 * second one to submit the form gets an empty client and a confusing failure.
 */
export function createRecoveryClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
