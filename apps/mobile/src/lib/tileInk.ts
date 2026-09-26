import { Colors } from '../constants/theme';

/**
 * What colour the words go on a tile painted in somebody's wall colour.
 *
 * The House tab paints a room's tile in its main wall paint, and that colour is
 * the record's data rather than the palette's — anything from Alabaster to a
 * forest green — so the words on it cannot be chosen once. They are **measured**,
 * the same as every pair in `theme.ts`: ink or white, whichever reads better
 * against this wall by the WCAG ratio.
 *
 * Between the two there is a band of mid-tones where neither reaches 4.5:1 —
 * the worst is about 3.85:1, a grey-green of middling depth — and there the
 * words sit on a translucent white panel, the way anything laid over a
 * photograph sits on `photoOverlay`. A background you cannot pick a text colour
 * against gets something behind the text; it never gets a wall colour nudged
 * lighter, because the colour is the answer somebody came to read.
 */

/** 4.5:1, WCAG AA for body text. Tile text is 13–17pt, so the large-text 3:1 does not apply. */
export const TILE_MIN_CONTRAST = 4.5;

/** Behind the words when neither ink nor white reads on the wall. */
export const TILE_SCRIM = 'rgba(255, 255, 255, 0.78)';
const SCRIM_ALPHA = 0.78;

function channels(hex: string): [number, number, number] {
  const raw = hex.replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG 2.x relative luminance of a `#RRGGBB` or `#RGB` colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The wall as it reads under the scrim — white at `SCRIM_ALPHA` composited over it. */
export function underScrim(hex: string): string {
  const base = channels(hex);
  return toHex(base.map((c) => SCRIM_ALPHA * 255 + (1 - SCRIM_ALPHA) * c) as [number, number, number]);
}

/**
 * The words' colour on this wall, and whether they need the panel behind them.
 * With the panel they are always ink: the panel is near-white whatever is under it.
 */
export function tileInk(wall: string): { ink: string; scrim: boolean } {
  const dark = contrastRatio(wall, Colors.textPrimary);
  const light = contrastRatio(wall, Colors.white);
  if (Math.max(dark, light) < TILE_MIN_CONTRAST) return { ink: Colors.textPrimary, scrim: true };
  return { ink: dark >= light ? Colors.textPrimary : Colors.white, scrim: false };
}
