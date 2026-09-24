import fs from 'fs';
import path from 'path';
import { EDGE_FLOOR, edgeInsets } from './edgeInsets';

// "The buttons on the corners are difficult to push" — on an iPhone 17. Three
// causes, and each is pinned here because none of them shows up anywhere but a
// phone: the safe area answers zero where the glass still curves, hitSlop does
// nothing on the build people install, and iOS reads two quick taps as a zoom.

const zero = { top: 0, bottom: 0, left: 0, right: 0 };
const iphone = { top: 0, bottom: 34, left: 0, right: 0 };

describe('edgeInsets', () => {
  it('keeps what an iPhone reports, and adds nothing under its status bar', () => {
    expect(edgeInsets(iphone, 'standalone')).toEqual(iphone);
  });

  // The manifest hides both system bars on an installed Android phone, so the
  // safe area is all zeros while the corners are still rounded.
  it('floors the top and the bottom when the system bars are gone', () => {
    const e = edgeInsets(zero, 'fullscreen');
    expect(e.top).toBe(EDGE_FLOOR.topFullscreen);
    expect(e.bottom).toBe(EDGE_FLOOR.bottom);
  });

  it('never adds a band at the top when a status bar is above the page', () => {
    expect(edgeInsets(zero, 'standalone').top).toBe(0);
    expect(edgeInsets(zero, 'browser').top).toBe(0);
  });

  it('never shrinks an inset the system reported', () => {
    const tall = { top: 59, bottom: 34, left: 0, right: 0 };
    expect(edgeInsets(tall, 'fullscreen')).toEqual(tall);
  });

  it('keeps a bottom sheet off the very edge on a phone with no home indicator', () => {
    expect(edgeInsets(zero, 'standalone').bottom).toBe(EDGE_FLOOR.bottom);
  });
});

describe('what a tap can reach', () => {
  const SRC = path.resolve(__dirname, '..');
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return files(full);
    return /\.tsx$/.test(d.name) && !/\.test\.tsx$/.test(d.name) ? [full] : [];
  });

  // react-native-web 0.21 ignores hitSlop on Pressable and TouchableOpacity, so
  // a glyph "enlarged" with it has the glyph's own tap area on the web build.
  // Size the box instead, or pad it and pull the padding back with a margin.
  it('uses no hitSlop, which the web build silently ignores', () => {
    const offenders = files(SRC).filter((f) => /hitSlop\s*=/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('places controls against an edge with the floored insets, not the raw ones', () => {
    const raw = files(SRC).filter((f) => /useSafeAreaInsets\(/.test(fs.readFileSync(f, 'utf8')));
    expect(raw.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  // Two quick taps on the same control are two taps, not a zoom.
  it('tells iOS not to read a quick second tap as a zoom', () => {
    const html = fs.readFileSync(path.resolve(SRC, '..', 'public', 'index.html'), 'utf8');
    expect(html).toMatch(/html\s*\{[^}]*touch-action:\s*manipulation/);
  });
});
