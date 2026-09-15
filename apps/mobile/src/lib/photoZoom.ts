/**
 * The arithmetic behind the photo viewer, kept out of the component.
 *
 * A zoomable image is three numbers — a scale and a two-axis offset — and every
 * way one of these goes wrong is the same failure from the user's side: **the
 * picture is gone and there is no obvious way to get it back.** You push too
 * far and the photo slides off the edge into black; you pinch out and the thing
 * you were pinching *towards* drifts out from under your fingers; you zoom back
 * to fit and the image sits stubbornly off-centre. None of those throw, none
 * are visible in a screenshot of the code, and all of them are one sign or one
 * divisor away.
 *
 * So the numbers live here as pure functions with a test beside them, and the
 * component is left holding gestures and animation values. `photoZoom.test.ts`
 * pins the three that matter: an edge never leaves the frame, a pinch keeps its
 * focus point still, and fitting the image re-centres it.
 *
 * Bounds are measured against the **frame**, not the image's own aspect ratio.
 * Knowing the latter means asking the network how big the JPEG is before the
 * first gesture can be answered, which is a round trip and a failure case in
 * exchange for slightly tighter letterbox behaviour on a photo the person is
 * already looking at. The frame is the honest approximation.
 */

export interface Transform {
  scale: number;
  /** Offset from centre, in screen points, *after* scaling. */
  x: number;
  y: number;
}

export interface Frame {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Fit. Below this there is nothing to see that the strip didn't already show. */
export const MIN_SCALE = 1;

/**
 * Six is a serial number on a rating plate read from a photo taken across a
 * laundry — which is the read moment this whole feature exists for. Past that
 * a phone JPEG is showing its own pixels rather than the plate.
 */
export const MAX_SCALE = 6;

/** What a double tap goes to, and comes back from. */
export const DOUBLE_TAP_SCALE = 2.5;

export const FIT: Transform = { scale: MIN_SCALE, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * How far the image may be pushed on each axis before its own edge would come
 * inside the frame. Zero at fit, which is what makes zooming out re-centre
 * rather than leaving the picture parked in a corner.
 */
export function panBounds(frame: Frame, scale: number): Point {
  const s = clampScale(scale);
  return {
    x: Math.max(0, (frame.width * (s - 1)) / 2),
    y: Math.max(0, (frame.height * (s - 1)) / 2),
  };
}

/** Pulls an offset back inside {@link panBounds}. */
export function clampPan(transform: Transform, frame: Frame): Transform {
  const scale = clampScale(transform.scale);
  const bound = panBounds(frame, scale);
  // `+ 0` normalises a clamped -0, which is invisible everywhere except in a
  // test that compares the fitted transform against a literal.
  return {
    scale,
    x: Math.min(bound.x, Math.max(-bound.x, transform.x)) + 0,
    y: Math.min(bound.y, Math.max(-bound.y, transform.y)) + 0,
  };
}

/**
 * Change the scale while holding one point of the *photo* still under one point
 * of the *screen* — the midpoint between two fingers, or the spot a double tap
 * landed on.
 *
 * Without this a pinch scales about the centre of the frame, so the detail
 * somebody is zooming into travels away from their fingers as they do it, and
 * the further in they go the faster it leaves. It reads as the image fighting
 * back.
 *
 * `focus` is in screen points measured **from the centre of the frame**, which
 * is the same origin the offsets use.
 */
export function zoomAbout(
  current: Transform,
  nextScale: number,
  focus: Point,
  frame: Frame,
): Transform {
  const from = clampScale(current.scale);
  const to = clampScale(nextScale);
  const ratio = to / from;

  // The photo coordinate under `focus` is (focus - offset) / scale; keeping it
  // under `focus` after the change gives offset' = focus - (focus - offset) * ratio.
  return clampPan(
    {
      scale: to,
      x: focus.x - (focus.x - current.x) * ratio,
      y: focus.y - (focus.y - current.y) * ratio,
    },
    frame,
  );
}

/** Distance between two touches, for reading a pinch. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two touches, in the same coordinates they arrived in. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * What a double tap should do next: out to {@link DOUBLE_TAP_SCALE} about the
 * point tapped, or back to fit if it is already zoomed at all.
 *
 * "At all" rather than "at exactly the double-tap scale", because after a pinch
 * the scale is some arbitrary number and the only useful second answer is the
 * one that gets the whole picture back.
 */
export function toggleZoom(current: Transform, focus: Point, frame: Frame): Transform {
  if (current.scale > MIN_SCALE + 0.01) return FIT;
  return zoomAbout(current, DOUBLE_TAP_SCALE, focus, frame);
}
