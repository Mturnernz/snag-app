import { Platform } from 'react-native';

/**
 * Clear a stale in-app path out of the browser's address bar.
 *
 * On web, React Navigation's linking integration writes the URL back on every
 * navigation and re-reads it from `window.location` when `NavigationContainer`
 * mounts. A *matched* path beats `initialRouteName`, and `src/navigation/
 * linking.ts` deliberately leaves `/` unmapped so an unmatched URL falls
 * through to it — that fall-through is what carries `initialRouteName`, which
 * is the list.
 *
 * Signing out breaks the arrangement. Sign Out lives on the Profile tab, so the
 * address bar always reads `/you` at the moment the session ends; App.tsx
 * then unmounts the navigator and shows AuthScreen without touching the URL.
 * Signing back in remounts the container, which parses the leftover `/profile`
 * and lands there — the user never asked to go to Profile, they asked to log in.
 *
 * So: at the two auth transitions, put the address bar back to `/` unless the
 * URL is one somebody meant to arrive at.
 *
 * Exactly one is kept: `/snags/<id>`, which is what one person sends the other
 * when they want them to look at something. Following that link while signed
 * out means signing in first, and the snag has to survive the round trip or the
 * link was pointless.
 *
 * (It was three. `?report=<token>` and `?join=<code>` were the QR landings of
 * the retired product and went with it — see `isPreservedUrl`.)
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
export function isPreservedUrl(pathname: string, _search = ''): boolean {
  // A specific snag, not the `/snags` list tab: only the former names a record.
  if (/^\/snags\/[^/]+/.test(pathname)) return true;
  // `?report=` (the site QR landing) and `?join=` (an org invite) retired with
  // the B2B product. A specific snag is the only URL left worth preserving
  // across a sign-in round trip.
  return false;
}
