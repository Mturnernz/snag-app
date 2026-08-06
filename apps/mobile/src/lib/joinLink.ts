import { Platform, Linking } from 'react-native';
import { APP_URL } from './appUrl';

// The organisation join QR code.
//
// It used to encode the join code as bare text — `<QRCode value={org.join_code} />`
// — which meant the poster only worked for someone who already had SNAG open on
// its own scanner screen. Point a phone camera at it and you get the string
// "VDJQFNEM" and nothing to tap. That is exactly backwards for a sheet of paper
// on a wall whose whole audience is people who don't have the app yet.
//
// Site QR codes never had this problem: SiteDetailScreen has always encoded
// `${APP_URL}/?report=<token>`, a real URL. This is the same shape for joining.
//
// Bare-code posters are already printed and on walls, so the scanner still
// accepts them — see parseScannedJoinCode. That's why this is a widening rather
// than a format change: nothing anyone has laminated stops working.

export const JOIN_PARAM = 'join';

/** Both formats a join code can take: 8 chars of the current alphanumeric
 *  charset, or the 10-char lowercase hex of orgs that predate it and haven't
 *  regenerated since (20260711140000 left them alone deliberately). */
const CODE_PATTERN = /^[A-Za-z0-9]{8,10}$/;

/** What the QR code encodes. */
export function buildJoinLink(code: string): string {
  return `${APP_URL}/?${JOIN_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * A scanned payload → a join code, or null if it isn't one.
 *
 * Accepts the link form and the bare-code form, in that order. Any host is
 * allowed: `snagv1.netlify.app` codes have been printed too (see lib/appUrl),
 * and the code is checked against the server regardless — the URL is a carrier,
 * not a credential.
 */
export function parseScannedJoinCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const fromLink = joinCodeFromUrl(value);
  if (fromLink) return fromLink;

  return CODE_PATTERN.test(value) ? value : null;
}

/** The `?join=` code on the URL the app was opened with, if any. Read once on
 *  boot, like getQrReportToken in App.tsx — a landing, not a live route. */
export async function getInitialJoinCode(): Promise<string | null> {
  const url = Platform.OS === 'web'
    ? (typeof window === 'undefined' ? null : window.location.href)
    : await Linking.getInitialURL();
  return url ? joinCodeFromUrl(url) : null;
}

function joinCodeFromUrl(url: string): string | null {
  let code: string | null;
  try {
    code = new URL(url).searchParams.get(JOIN_PARAM);
  } catch {
    return null;
  }
  if (!code) return null;
  const trimmed = code.trim();
  return CODE_PATTERN.test(trimmed) ? trimmed : null;
}
