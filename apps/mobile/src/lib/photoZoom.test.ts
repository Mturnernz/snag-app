import {
  clampPan, clampScale, distance, FIT, MAX_SCALE, midpoint, MIN_SCALE,
  panBounds, toggleZoom, zoomAbout,
} from './photoZoom';

// Every failure this file guards against looks the same from the other side of
// the screen: the photo is gone and nothing on screen says how to get it back.
// They are all one sign or one divisor away from correct, none of them throw,
// and none of them are visible in a screenshot of the code.

const frame = { width: 400, height: 800 };

describe('how far the picture may be pushed', () => {
  // Drag hard enough with a naive implementation and the image leaves the
  // frame entirely. There is then nothing on screen to drag back.
  it('never lets an edge come inside the frame', () => {
    const bound = panBounds(frame, 2);
    expect(bound).toEqual({ x: 200, y: 400 });

    const shoved = clampPan({ scale: 2, x: 10_000, y: -10_000 }, frame);
    expect(shoved.x).toBe(200);
    expect(shoved.y).toBe(-400);
  });

  // The whole reason zooming out feels like "back to normal" rather than "back
  // to normal, but over there".
  it('has nowhere to go at fit, so zooming out re-centres', () => {
    expect(panBounds(frame, MIN_SCALE)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ scale: 1, x: 120, y: -90 }, frame)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('refuses a scale outside what the viewer offers', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(40)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
  });
});

describe('pinching towards something', () => {
  // Scale about the centre instead and the detail being zoomed into travels
  // away from the fingers doing the zooming, faster the further in you go. It
  // reads as the image fighting back.
  it('keeps the point under the fingers under the fingers', () => {
    const focus = { x: 100, y: -150 };
    const after = zoomAbout(FIT, 2, focus, frame);

    // The photo coordinate under `focus` before and after must be the same.
    const before = { x: (focus.x - FIT.x) / FIT.scale, y: (focus.y - FIT.y) / FIT.scale };
    const now = { x: (focus.x - after.x) / after.scale, y: (focus.y - after.y) / after.scale };
    expect(now.x).toBeCloseTo(before.x, 6);
    expect(now.y).toBeCloseTo(before.y, 6);
  });

  it('still cannot push an edge in while doing it', () => {
    const after = zoomAbout(FIT, 1.2, { x: 200, y: 400 }, frame);
    const bound = panBounds(frame, after.scale);
    expect(Math.abs(after.x)).toBeLessThanOrEqual(bound.x + 1e-9);
    expect(Math.abs(after.y)).toBeLessThanOrEqual(bound.y + 1e-9);
  });

  it('reads a pinch from the two touches', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: -20 })).toEqual({ x: 5, y: -10 });
  });
});

describe('double tap', () => {
  it('goes in on the spot tapped', () => {
    const after = toggleZoom(FIT, { x: 80, y: 40 }, frame);
    expect(after.scale).toBeGreaterThan(1);
    expect(after.x).not.toBe(0);
  });

  // After a pinch the scale is some arbitrary number, and the only useful
  // second answer is the one that puts the whole picture back on screen.
  it('comes all the way back from wherever a pinch left it', () => {
    expect(toggleZoom({ scale: 3.7, x: 55, y: -20 }, { x: 0, y: 0 }, frame)).toEqual(FIT);
  });
});
