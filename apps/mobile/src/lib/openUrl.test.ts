import { Platform } from 'react-native';

import { showAlert } from './alert';
import { linkify, openUrl } from './openUrl';

jest.mock('./alert', () => ({ showAlert: jest.fn() }));

/**
 * Opening a link on the web build.
 *
 * `window.open` with `noopener` in its features returns null by spec — the
 * value a blocked popup returns — so the guard read every successful open as
 * blocked, and "Your browser blocked the new tab" came up each time somebody
 * closed a PDF and came back. These pin the tab opening, its opener being cut
 * before it is pointed anywhere, and the alert kept for a real block.
 */
describe('openUrl on the web', () => {
  const realWindow = (global as any).window;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  afterAll(() => {
    (global as any).window = realWindow;
  });

  it('opens the tab and says nothing when the browser allows it', () => {
    const steps: string[] = [];
    const tab = {
      location: {} as { href?: string },
      set opener(value: unknown) { steps.push(`opener=${String(value)}`); },
    };
    Object.defineProperty(tab.location, 'href', {
      set(value: string) { steps.push(`href=${value}`); },
    });
    const open = jest.fn(() => tab);
    (global as any).window = { open };

    openUrl('https://example.co/invoice.pdf');

    // No `noopener` in the features: that is what made the return value null.
    expect(open).toHaveBeenCalledWith('', '_blank');
    // The handle back into the session is cut before the page is asked for.
    expect(steps).toEqual(['opener=null', 'href=https://example.co/invoice.pdf']);
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('still says so when the popup really is blocked', () => {
    (global as any).window = { open: jest.fn(() => null) };

    openUrl('https://example.co/invoice.pdf');

    expect(showAlert).toHaveBeenCalledWith(
      "Couldn't open that",
      'Your browser blocked the new tab. Allow pop-ups and try again.',
    );
  });
});

/**
 * Where a link stops.
 *
 * Every way this goes wrong is a boundary: one character too many sends
 * somebody to a 404 and they blame the person who wrote the note, and one too
 * few sends them to a page that is not the one that was meant. Pinned as
 * properties rather than as a screenshot, because the component around it only
 * renders what this decides.
 */
describe('finding the links in a line of prose', () => {
  it('leaves prose with no address entirely alone', () => {
    expect(linkify('Ordered the part, arriving Tuesday'))
      .toEqual([{ text: 'Ordered the part, arriving Tuesday' }]);
  });

  it('keeps the words either side of the address', () => {
    expect(linkify('Seat is https://mitre10.co.nz/p/123 — $42'))
      .toEqual([
        { text: 'Seat is ' },
        { text: 'https://mitre10.co.nz/p/123', url: 'https://mitre10.co.nz/p/123' },
        { text: ' — $42' },
      ]);
  });

  // A sentence's full stop belongs to the sentence.
  it.each(['.', ',', ';', ':', '!', '?'])('drops a trailing "%s"', (mark) => {
    const [, link, tail] = linkify(`See https://x.co/a${mark} Thanks`);
    expect(link).toEqual({ text: 'https://x.co/a', url: 'https://x.co/a' });
    expect(tail.text).toBe(`${mark} Thanks`);
  });

  // Wikipedia-shaped addresses carry brackets of their own, so a closing one
  // counts only when it was opened inside the link.
  it('keeps a bracket the address opened', () => {
    expect(linkify('https://x.co/a_(b)')[0])
      .toEqual({ text: 'https://x.co/a_(b)', url: 'https://x.co/a_(b)' });
  });

  it('drops a bracket the sentence opened', () => {
    const pieces = linkify('(see https://x.co/a)');
    expect(pieces[1]).toEqual({ text: 'https://x.co/a', url: 'https://x.co/a' });
    expect(pieces[2].text).toBe(')');
  });

  // Schemeless is how people actually write it, and `window.open` resolves a
  // schemeless string against the app's own origin — which re-opens the app
  // and reads as nothing having happened.
  it('gives a bare www. address a scheme without changing what is shown', () => {
    expect(linkify('www.resene.co.nz')[0])
      .toEqual({ text: 'www.resene.co.nz', url: 'https://www.resene.co.nz' });
  });

  it('finds every address in one note', () => {
    const links = linkify('https://a.co and www.b.co and https://c.co')
      .filter((piece) => piece.url)
      .map((piece) => piece.url);
    expect(links).toEqual(['https://a.co', 'https://www.b.co', 'https://c.co']);
  });

  it('is not fooled by a bare "www." with nothing after it', () => {
    expect(linkify('www. something').every((piece) => !piece.url)).toBe(true);
  });

  it('round-trips the whole string whatever it finds', () => {
    for (const note of [
      'nothing here',
      'https://x.co',
      'a https://x.co b www.y.co c.',
      '(https://x.co/a_(b)).',
    ]) {
      expect(linkify(note).map((piece) => piece.text).join('')).toBe(note);
    }
  });
});
