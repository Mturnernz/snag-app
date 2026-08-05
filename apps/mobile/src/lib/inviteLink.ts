import { PORTAL_URL } from './appUrl';

// The link an invite email carries, and the one an admin copies out of Manage
// Organisation.
//
// It points at the **portal**, not this app, for the same reason every per-snag
// notification points at `/go/snag/<id>`: the sender doesn't know which client
// the reader needs. An invite goes to someone who has no account yet, so their
// role is a fact about the invite rather than about them — and the two roles
// need opposite destinations once they're in. `/join/<token>` decides that
// after the invite is accepted, when the answer is actually known.
//
// Note this is deliberately the one other place (with sendPasswordReset) where
// this app hands off to a web page it doesn't own. The invitee is reading mail,
// not holding an app they haven't installed.

/** What the invite email links to, and what "Copy invite link" puts on the clipboard. */
export function buildInviteLink(token: string): string {
  return `${PORTAL_URL}/join/${encodeURIComponent(token)}`;
}

/**
 * A pasted invite link or bare token → the token, or null if it's neither.
 *
 * The app's own join screen accepts a pasted *code*, and people paste whatever
 * the email gave them — which is now a URL. Taking only the bare token would
 * reject the thing the mail put in front of them, so this accepts both.
 *
 * Any host is allowed: the token is checked against the server regardless, so
 * the URL is a carrier, not a credential — the same reasoning as
 * parseScannedJoinCode.
 */
export function parseInviteToken(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (UUID_PATTERN.test(value)) return value;

  // Last non-empty path segment, so both /join/<token> and any future prefix
  // resolve without this needing to know the route.
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    return null;
  }
  const last = path.split('/').filter(Boolean).pop() ?? '';
  const token = decodeURIComponent(last);
  return UUID_PATTERN.test(token) ? token : null;
}

/** `invites.token` is a uuid column — the invite code is its text form. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
