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
 * Three are kept:
 *
 * - `/snags/<id>` — what one person sends the other when they want them to look
 *   at something. Following it while signed out means signing in first, and the
 *   snag has to survive the round trip or the link was pointless.
 * - `/projects/<id>` — the other thing one person sends the other, now that
 *   `linking.ts` resolves it. It has to be kept for the same reason and it is
 *   the same failure if it is not: a link that works when you are already
 *   signed in and drops you on the list when you are not is worse than one
 *   that never worked, because nobody can tell which they are getting.
 * - `/join/<token>` — a household's QR code. This one is *load-bearing*: the
 *   person scanning has almost certainly never signed in here, so the sign-up
 *   round trip is the normal case rather than the edge one. Lose the token
 *   there and they land on an empty Setup screen with no idea what they just
 *   scanned, and the code is not recoverable from anything on screen.
 *
 * (The retired product's `?report=<token>` and `?join=<code>` query landings
 * went with it; this is a path, and a different mechanism — see joinLink.ts.)
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
  // A specific project, on the same terms — and `/projects` on its own is the
  // tab, which somebody may have put away, so it is deliberately not kept.
  if (/^\/projects\/[^/]+/.test(pathname)) return true;
  // A household's join code. Signing up IS the journey here — somebody who has
  // just scanned a QR has no account yet — so this has to survive both
  // transitions or the code is gone and nothing on screen can recover it.
  if (/^\/join\/[^/]+/.test(pathname)) return true;
  // The retired product's `?report=` and `?join=` query landings went with it.
  return false;
}
