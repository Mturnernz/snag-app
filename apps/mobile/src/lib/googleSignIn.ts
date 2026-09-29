import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';
import { isPreservedUrl } from './webLocation';

/** Where Google sends a native sign-in back to. On the allow-list in Supabase → Auth. */
export const NATIVE_AUTH_REDIRECT = 'snag://auth-callback';

export type GoogleOutcome = 'redirecting' | 'signed-in' | 'cancelled';

/**
 * Whether *Continue with Google* is offered at all.
 *
 * Off until the Google side is set up for households — the consent screen
 * opened past the snaghq.co.nz Workspace and the app on Auth's redirect
 * allow-list (`SNAG_INFRA_NOTES.md`, *Households sign in with Google too*).
 * Before that, a household pressing it is refused by Google on a page the app
 * cannot word, which is a button that is worse than no button. Set
 * `EXPO_PUBLIC_GOOGLE_SIGN_IN=on` in the build's environment to show it. Read
 * on each call rather than once, so a test can turn it on and off; Expo
 * inlines the value at build time either way.
 */
export function googleSignInEnabled(): boolean {
  return process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN === 'on';
}

/**
 * Where a web sign-in comes back to: this origin, keeping the one path worth
 * keeping.
 *
 * **A join code must survive the round trip**, for the reason `isPreservedUrl`
 * keeps it across sign-in: somebody who has just scanned a QR has no account,
 * so signing up *is* the journey, and a Google sign-in that came back to `/`
 * would drop the code on the floor with nothing on screen able to recover it.
 * The same goes for a sent `/snags/<id>`. Everything else comes back to the
 * list. Pure, so the test needs no browser.
 */
export function webRedirectTarget(origin: string, pathname: string): string {
  return isPreservedUrl(pathname) ? `${origin}${pathname}` : `${origin}/`;
}

/**
 * The two tokens out of the address Google's round trip ends on.
 *
 * The client is on the implicit flow, so they arrive in the fragment; a query
 * string is read too, because an in-app browser has been known to move one.
 * Null when either is missing — a half session is not one.
 */
export function tokensFromRedirect(url: string): { accessToken: string; refreshToken: string } | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const read = (key: string) =>
    new URLSearchParams(hash).get(key) ?? new URLSearchParams(query).get(key);
  const accessToken = read('access_token');
  const refreshToken = read('refresh_token');
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

/**
 * Sign in with Google — the new-phone moment of signing into the account you
 * already have, rather than inventing a password for one more app.
 *
 * **On the web build**, which is what people install, it is Supabase's own
 * redirect: the page leaves for Google and comes back holding the session in
 * the fragment, which `detectSessionInUrl` already reads. Nothing new runs on
 * the way back, and App.tsx's auth listener takes over exactly as it does for a
 * password. Resolves `redirecting` because the page is about to go.
 *
 * **On native** there is no page to leave, so Google opens in the system's
 * auth browser and hands the tokens back through `snag://auth-callback`.
 * A closed browser is `cancelled` and says nothing: backing out of a sign-in is
 * not an error. Anything else throws, for the screen to say in one sentence.
 *
 * Nothing here awaits inside `onAuthStateChange` — `setSession` is called from
 * a press, never from the listener, which must stay synchronous.
 */
export async function signInWithGoogle(): Promise<GoogleOutcome> {
  if (Platform.OS === 'web') {
    const { origin, pathname } = window.location;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: webRedirectTarget(origin, pathname) },
    });
    if (error) throw error;
    return 'redirecting';
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Google didn't answer. Please try again.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_AUTH_REDIRECT);
  if (result.type !== 'success') return 'cancelled';

  const tokens = tokensFromRedirect(result.url);
  if (!tokens) throw new Error("Google didn't finish signing you in. Please try again.");

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (sessionError) throw sessionError;
  return 'signed-in';
}

/**
 * The name Google already knows, offered on the first question rather than
 * asked from scratch. The first name, because that is what the other person in
 * the house calls you, and what every list here shows. Null when there is none.
 */
export function nameFromIdentity(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const given = typeof metadata.given_name === 'string' ? metadata.given_name.trim() : '';
  if (given) return given;
  const full = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string' ? metadata.name : '';
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first || null;
}
