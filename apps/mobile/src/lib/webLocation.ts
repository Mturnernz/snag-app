import { Platform } from 'react-native';

/**
 * Clear a stale in-app path out of the browser's address bar.
 *
 * On web, React Navigation's linking integration writes the URL back on every
 * navigation and re-reads it from `window.location` when `NavigationContainer`
 * mounts. A *matched* path beats `initialRouteName`, and `src/navigation/
 * linking.ts` deliberately leaves `/` unmapped so an unmatched URL falls
 * through to it — that fall-through is what carries `initialTab`.
 *
 * Signing out breaks the arrangement. Sign Out lives on the Profile tab, so the
 * address bar always reads `/profile` at the moment the session ends; App.tsx
 * then unmounts the navigator and shows AuthScreen without touching the URL.
 * Signing back in remounts the container, which parses the leftover `/profile`
 * and lands there — the user never asked to go to Profile, they asked to log in.
 *
 * So: at the two auth transitions, put the address bar back to `/` unless the
 * URL is one somebody meant to arrive at.
 *
 * Two are kept:
 *
 * - `/snags/<id>` — what `supabase/functions/notify-snag` mails people. Someone
 *   following that link while signed out has to sign in first, and the snag has
 *   to survive the round trip or the link was pointless.
 * - `?report=<token>` — the QR public-report landing, read on boot by
 *   `getQrReportToken`. Its anonymous sign-in fires an auth event of its own.
 * - `?join=<code>` — the org join QR landing, read on boot by
 *   `getInitialJoinCode`. Someone scanning a "scan to join" poster signs up or
 *   signs in on the way through, so it has to survive both transitions or the
 *   poster drops them on the default tab of an org they haven't joined.
 *
 * No-ops off web: on native there is no address bar, `history` doesn't exist,
 * and a cold launch has no initial URL to be stale.
 */
export function resetWebPathIfStale(): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || !window.history?.replaceState) return;

  const { pathname, search } = window.location;
  if (pathname === '/' && !search) return;
  if (isPreservedUrl(pathname, search)) return;

  window.history.replaceState(null, '', '/');
}

/** Exported for the unit test — the rules above, without the browser. */
export function isPreservedUrl(pathname: string, search: string): boolean {
  // A specific snag, not the `/snags` list tab: only the former names a record.
  if (/^\/snags\/[^/]+/.test(pathname)) return true;
  const params = new URLSearchParams(search);
  if (params.has('report')) return true;
  if (params.has('join')) return true;
  return false;
}
