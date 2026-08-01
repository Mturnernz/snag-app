// Where to scroll so a step card on a serious snag is actually on screen.
//
// NextStepCard names the one thing to do now and its CTA opens that card. It
// used to only set the expanded flag, which is invisible: the target sits below
// the hero photo, the description, the meta block, the Next-step card itself and
// one or two other steps, so the most prominent button on a serious snag looked
// like it did nothing at all.
//
// apps/web has no equivalent of this file because it doesn't need one — its CTA
// is an <a href="...#witnesses"> into a <details id>, and the browser does the
// scrolling. React Native has no fragment navigation, so the offset is computed.

/** A little air above the card, so it reads as "here" rather than as the page
 *  having been cut off. Not a header height — ScreenHeader is a sibling of the
 *  ScrollView, not an overlay, so nothing covers the top of the content. */
export const HEADROOM = 12;

/** Extracted as a pure function so the arithmetic is testable without a
 *  renderer — the two coordinate spaces are exactly where this goes wrong. */
export function stepScrollOffset(contentY: number, stepY: number, headroom = HEADROOM): number {
  // Clamped: the first step card can sit close enough to the top that
  // subtracting headroom goes negative, and a negative offset bounces on iOS.
  return Math.max(0, contentY + stepY - headroom);
}
