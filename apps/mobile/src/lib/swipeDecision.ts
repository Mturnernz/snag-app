/**
 * What a drag across a review card means, in one place and with no component
 * around it.
 *
 * This is `photoZoom.ts`' argument one screen over: every way a swipe-to-decide
 * control goes wrong is the same failure from the other side of the screen —
 * *it did something I didn't ask for* — and each is one comparison or one sign
 * away. A card that approves a bill on a 12px twitch is worse than one that
 * never swipes at all, because the first is money on a job and the second is a
 * button press away from working.
 *
 * So the thresholds are a pure function `swipe.test.ts` can pin as properties,
 * rather than four magic numbers spread through a `PanResponder`.
 *
 * **Right is yes, left is no**, which is the only way round these can go: it is
 * the gesture every triage deck has taught, and reversing it here would be the
 * one app where the muscle memory costs somebody a bill.
 */

export type SwipeDecision = 'approve' | 'decline';

/**
 * How far across the card a drag has to travel before it decides anything.
 *
 * A quarter of the card, floored at 64px. Proportional alone is wrong on a
 * phone in portrait — a quarter of 320pt is 80pt, which is fine, but a quarter
 * of a 200pt card in a narrow split view is 50pt, which is a thumb resting.
 * The floor is what keeps the cheapest accident expensive enough.
 */
export const SWIPE_FLOOR = 64;

/** Past this the card is committed and lets go at the edge rather than snapping back. */
export function swipeThreshold(width: number): number {
  return Math.max(SWIPE_FLOOR, width * 0.25);
}

/**
 * What this drag decided, or nothing.
 *
 * Nothing is the common answer and it is deliberately the default: a drag that
 * did not clearly mean yes or no snaps back and asks again. There is no
 * "roughly right" here.
 */
export function swipeDecision(dx: number, width: number): SwipeDecision | null {
  const threshold = swipeThreshold(width);
  if (dx >= threshold) return 'approve';
  if (dx <= -threshold) return 'decline';
  return null;
}

/**
 * How strongly the card is showing its answer while the finger is still down.
 *
 * Zero at rest and one at the threshold, clamped — so the label behind the card
 * is fully legible exactly when letting go would act on it, and the person can
 * see what they are about to do before they have done it. Clamping at one
 * rather than letting it run on matters: an opacity above 1 is a no-op on
 * native and a validation error in some web engines, and the difference is a
 * card that renders nothing at all.
 */
export function swipeProgress(dx: number, width: number): number {
  const threshold = swipeThreshold(width);
  if (threshold <= 0) return 0;
  return Math.min(1, Math.abs(dx) / threshold);
}

/**
 * Which way the card is leaning, before it has decided anything.
 *
 * Distinct from `swipeDecision` on purpose: this is what the *hint* reads from,
 * so a 10px drag already says which answer is coming, while the decision itself
 * still needs the whole threshold. One function for both would either commit
 * too early or say nothing until it was too late to change your mind.
 */
export function swipeLean(dx: number): SwipeDecision | null {
  if (dx === 0) return null;
  return dx > 0 ? 'approve' : 'decline';
}

/**
 * Whether a drag was a swipe at all, or a scroll the card should not have
 * claimed.
 *
 * A review card sits in a vertical `ScrollView`, and a `PanResponder` that
 * takes every touch is a card that eats the page's scrolling — which reads as
 * the screen being frozen. So a gesture is this card's only once it is more
 * across than down, with a few pixels of slack so a dead-straight horizontal
 * drag is not required.
 */
export function isHorizontalDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8;
}
