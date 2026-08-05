// Where the walkthrough's spotlight and its callout go.
//
// Extracted as pure functions for the same reason `stepScroll.ts` was: the
// arithmetic is where this goes wrong, and it goes wrong in ways a screenshot
// doesn't catch — a scrim rect one pixel short leaves a bright seam, and a
// callout placed below a control near the bottom of the screen renders off the
// end of the phone. Neither needs a renderer to test.
//
// The hole is cut with four rects rather than an SVG mask. `react-native-svg`
// is a dependency and would work, but four Views need no library, behave
// identically under react-native-web, and — because they are siblings with a
// gap between them rather than one element with a hole — leave the spotlit
// control genuinely untouched: it keeps its own hit area instead of receiving
// taps through a mask.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  bottom: number;
}

/** Air between the control and the edge of the hole, so it reads as pointed at
 *  rather than as cropped. */
export const SPOTLIGHT_PADDING = 8;

/** Between the hole and the callout. */
export const CALLOUT_GAP = 12;

/** The callout is a phone-shaped card. `apps/mobile` also runs at desktop
 *  widths on the web build, where a full-bleed instruction card reads as a
 *  banner rather than as a pointer at something. */
export const CALLOUT_MAX_WIDTH = 380;

/** Used before the callout has measured itself once. Overshooting is the safe
 *  direction: it biases the first frame towards centring rather than towards
 *  placing a card half off the screen. */
export const CALLOUT_ASSUMED_HEIGHT = 260;

/**
 * A target rect grown by `padding` and clamped to the viewport.
 *
 * Clamping matters for the tab bar, which sits flush against the bottom edge —
 * an unclamped hole extends past it and the bottom scrim rect gets a negative
 * height, which React Native renders as zero and react-native-web renders as
 * a layout warning.
 */
export function inflate(rect: Rect, viewport: Viewport, padding = SPOTLIGHT_PADDING): Rect {
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(viewport.width, rect.x + rect.width + padding);
  const bottom = Math.min(viewport.height, rect.y + rect.height + padding);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The four scrim rects around a hole, in order: above, below, left, right.
 *
 * The left and right rects span only the hole's own band, so the four never
 * overlap — two half-opaque rects on top of each other would be visibly darker
 * than the rest of the scrim, in a band the eye is already drawn to.
 */
export function scrimRects(hole: Rect, viewport: Viewport): Rect[] {
  const holeBottom = hole.y + hole.height;
  const holeRight = hole.x + hole.width;
  return [
    { x: 0, y: 0, width: viewport.width, height: Math.max(0, hole.y) },
    { x: 0, y: holeBottom, width: viewport.width, height: Math.max(0, viewport.height - holeBottom) },
    { x: 0, y: hole.y, width: Math.max(0, hole.x), height: hole.height },
    { x: holeRight, y: hole.y, width: Math.max(0, viewport.width - holeRight), height: hole.height },
  ];
}

export type CalloutPlacement = 'above' | 'below' | 'centre';

/**
 * Whether the callout sits above the hole, below it, or — when neither side
 * has room — centred over the screen with the spotlight still cut.
 *
 * Below is preferred because most spotlit controls are in the upper two-thirds
 * of a form and because a card under your thumb is easier to reach than one
 * above it. The exception that forces the whole function to exist is the tab
 * bar: it is the first thing the walkthrough points at and there is never room
 * below it.
 */
export function calloutPlacement(
  hole: Rect | null,
  viewport: Viewport,
  calloutHeight: number,
  insets: Insets,
): { placement: CalloutPlacement; top: number } {
  const centred = {
    placement: 'centre' as const,
    top: Math.max(insets.top, Math.round((viewport.height - calloutHeight) / 2)),
  };
  if (!hole) return centred;

  const holeBottom = hole.y + hole.height;
  const roomBelow = viewport.height - insets.bottom - (holeBottom + CALLOUT_GAP);
  if (roomBelow >= calloutHeight) {
    return { placement: 'below', top: holeBottom + CALLOUT_GAP };
  }

  const roomAbove = hole.y - CALLOUT_GAP - insets.top;
  if (roomAbove >= calloutHeight) {
    return { placement: 'above', top: hole.y - CALLOUT_GAP - calloutHeight };
  }

  return centred;
}

/** Horizontal size and offset of the callout — centred, capped, gutter either side. */
export function calloutFrame(viewport: Viewport, gutter = 16): { left: number; width: number } {
  const width = Math.min(CALLOUT_MAX_WIDTH, viewport.width - gutter * 2);
  return { left: Math.round((viewport.width - width) / 2), width };
}

/**
 * Whether a measured rect is worth cutting a hole around.
 *
 * A control inside a ScrollView that hasn't been scrolled to measures with
 * real coordinates that are simply off-screen, and a control mid-mount
 * measures as a zero-size rect at the origin. Both produce a spotlight over
 * nothing, which is worse than no spotlight — so both fall back to a centred
 * callout, which still says what to do.
 */
export function isUsableTarget(rect: Rect | null, viewport: Viewport): rect is Rect {
  if (!rect) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Wholly outside the viewport in either axis.
  if (rect.y + rect.height <= 0 || rect.y >= viewport.height) return false;
  if (rect.x + rect.width <= 0 || rect.x >= viewport.width) return false;
  return true;
}
