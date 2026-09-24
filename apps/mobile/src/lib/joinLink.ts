import { Platform } from 'react-native';

/**
 * Reading a `/join/<token>` code out of the address bar, and clearing it again.
 *
 * **Web only, and that is the whole design rather than a gap.** The QR is
 * scanned by the *scanner's own camera*, which opens an ordinary URL in their
 * browser — and the person scanning has not installed Snag, which is precisely
 * why they are being handed a link. So the only place this token can ever
 * arrive is the web build. Native keeps the `snag://` prefix list for
 * `/snags/<id>`, which is a link one household member sends another and a
 * different journey entirely.
 *
 * The token is read before `NavigationContainer` mounts (App.tsx answers it as
 * a gate), so `/join/...` is deliberately NOT in `linking.ts`: a matched path
 * would send React Navigation somewhere while the gate is trying to ask a
 * question.
 */
const JOIN_PATH = /^\/join\/([0-9a-fA-F-]{36})\/?$/;

/** The token in the current URL, or null. Never throws on a hostile path. */
export function readJoinToken(): string | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined' || !window.location) return null;
  const match = JOIN_PATH.exec(window.location.pathname);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Takes the code out of the address bar once it has been answered.
 *
 * Without this, joining leaves `/join/<token>` in the URL and the next reload
 * asks the same question about a household they are already in — and a
 * refusal leaves them stuck on it for ever.
 */
export function clearJoinToken(): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  if (!JOIN_PATH.test(window.location.pathname)) return;
  window.history.replaceState(null, '', '/');
}

/**
 * The code in something pasted — the whole link, or just the code.
 *
 * Somebody who signed up before they were sent anything is left on a screen
 * whose only action was *Check again*; if the other person has since sent a
 * link, pasting it is the way in. Anything with a 36-character code in it is
 * read, because a link arrives from a messaging app wrapped in whatever that
 * app thought it should add.
 */
export function parseJoinToken(text: string): string | null {
  const match = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(text);
  return match ? match[1].toLowerCase() : null;
}
