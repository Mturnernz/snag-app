import { Linking, Platform } from 'react-native';

import { showAlert } from './alert';

/**
 * Opening a link somebody typed, in whatever the device calls its browser.
 *
 * One path, because a link is opened from four places — a note, a job's
 * description, an assessment's source row, a stored PDF — and "it opened in the
 * wrong place" is the kind of difference nobody reports and everybody notices.
 *
 * **On web it is `window.open` with `noopener`, not `Linking.openURL`.**
 * react-native-web implements `openURL` by assigning `window.location`, which
 * replaces the app. That is right for a `tel:` and wrong for a link in a note:
 * this is a single-page app holding unsent state — a half-typed note, an open
 * sheet, a scroll position in a list somebody spent a minute reaching — and
 * navigating away drops all of it to show a supplier's website. It also strips
 * the app from the browser's back stack in exactly the way that makes people
 * think they have lost their work.
 *
 * `noopener` is not optional: without it the opened page gets a live
 * `window.opener` handle back into a signed-in session. **But it cannot go in
 * `window.open`'s features string.** The spec says a `noopener` open returns
 * `null` — the same value a blocked popup returns — so the guard below read
 * every successful open as blocked, and the alert surfaced the moment
 * somebody closed the PDF and came back to the app. So the tab is opened
 * blank, its opener cut by hand, and only then pointed at the address: the
 * page never loads with a handle to cut. The referrer that `noreferrer` also
 * suppressed is left to the site's `Referrer-Policy`, which already gives
 * another site our origin and nothing more.
 *
 * **Native keeps `Linking.openURL`**, which is the OS handler and therefore the
 * default browser — or better, the app that owns the scheme.
 */
export function openUrl(url: string): void {
  if (Platform.OS === 'web') {
    // Guarded: a browser that refuses the popup returns null rather than
    // throwing, and a link that silently does nothing is the failure this
    // whole helper exists to make impossible.
    const opened = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (!opened) {
      showAlert("Couldn't open that", 'Your browser blocked the new tab. Allow pop-ups and try again.');
      return;
    }
    opened.opener = null;
    opened.location.href = url;
    return;
  }

  Linking.openURL(url).catch(() => {
    showAlert("Couldn't open that", 'Nothing on this device offered to open the link.');
  });
}

/**
 * Where a link starts and stops inside a line of prose.
 *
 * Exported and pure so `linkify.test.ts` can pin it without rendering
 * anything — every way this goes wrong is a boundary, and a boundary is a
 * property rather than a screenshot.
 *
 * Three rules, each of which was a real way of getting this wrong:
 *
 * - **Trailing punctuation is not part of the link.** "See https://x.co/a." is
 *   a sentence, and the full stop belongs to the sentence. A greedy match sends
 *   somebody to a 404 and they blame the person who wrote the note.
 * - **A closing bracket only counts if it was opened.** Wikipedia-shaped URLs
 *   carry parentheses, and "(see https://x.co/a_(b))" has one of each kind.
 * - **`www.` gets a scheme.** People write it without one, and `window.open`
 *   on a schemeless string resolves it against the app's own origin — which
 *   opens the app again rather than the site, and looks like nothing happened.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

export interface TextPiece {
  text: string;
  /** Absent on prose. The address to open, scheme included. */
  url?: string;
}

export function linkify(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let at = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let found = match[0];

    // Walk back off anything that reads as sentence punctuation rather than
    // address. Brackets are kept only while they balance.
    while (found.length > 0) {
      const last = found[found.length - 1];
      if ('.,;:!?'.includes(last)) { found = found.slice(0, -1); continue; }
      if (last === ')' && count(found, '(') < count(found, ')')) { found = found.slice(0, -1); continue; }
      if (last === ']' && count(found, '[') < count(found, ']')) { found = found.slice(0, -1); continue; }
      break;
    }

    // A bare "www." or a match that was all punctuation is not an address.
    if (!/[a-z0-9]/i.test(found.replace(/^https?:\/\//i, '').replace(/^www\./i, ''))) continue;

    if (start > at) pieces.push({ text: text.slice(at, start) });
    pieces.push({
      text: found,
      url: /^www\./i.test(found) ? `https://${found}` : found,
    });
    at = start + found.length;
  }

  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

function count(text: string, character: string): number {
  let seen = 0;
  for (const one of text) if (one === character) seen += 1;
  return seen;
}
