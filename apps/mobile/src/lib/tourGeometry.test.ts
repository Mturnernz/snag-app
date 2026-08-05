import {
  CALLOUT_GAP,
  CALLOUT_MAX_WIDTH,
  SPOTLIGHT_PADDING,
  calloutFrame,
  calloutPlacement,
  inflate,
  isUsableTarget,
  scrimRects,
} from './tourGeometry';

const PHONE = { width: 390, height: 844 };
const NO_INSETS = { top: 0, bottom: 0 };

describe('inflate', () => {
  it('grows the target by the padding', () => {
    const r = inflate({ x: 100, y: 200, width: 80, height: 40 }, PHONE);
    expect(r).toEqual({
      x: 100 - SPOTLIGHT_PADDING,
      y: 200 - SPOTLIGHT_PADDING,
      width: 80 + SPOTLIGHT_PADDING * 2,
      height: 40 + SPOTLIGHT_PADDING * 2,
    });
  });

  it('clamps to the viewport at the bottom edge', () => {
    // The tab bar. An unclamped hole runs past the bottom of the screen and the
    // bottom scrim rect gets a negative height.
    const tabBar = { x: 0, y: PHONE.height - 60, width: PHONE.width, height: 60 };
    const r = inflate(tabBar, PHONE);
    expect(r.y).toBe(PHONE.height - 60 - SPOTLIGHT_PADDING);
    expect(r.y + r.height).toBe(PHONE.height);
    expect(r.x).toBe(0);
    expect(r.width).toBe(PHONE.width);
  });
});

describe('scrimRects', () => {
  const hole = { x: 100, y: 300, width: 120, height: 50 };
  const rects = scrimRects(hole, PHONE);

  it('returns four rects that leave exactly the hole uncovered', () => {
    expect(rects).toHaveLength(4);
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(0);
      expect(r.height).toBeGreaterThanOrEqual(0);
    }
    const area = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(area).toBe(PHONE.width * PHONE.height - hole.width * hole.height);
  });

  it('never overlaps two rects', () => {
    // Overlapping half-opaque scrims render as a visibly darker band, right
    // where the eye is already looking. The area check above is what proves it.
    const [above, below, left, right] = rects;
    expect(above.y + above.height).toBe(hole.y);
    expect(below.y).toBe(hole.y + hole.height);
    expect(left.y).toBe(hole.y);
    expect(left.height).toBe(hole.height);
    expect(right.y).toBe(hole.y);
    expect(right.height).toBe(hole.height);
  });

  it('handles a hole flush against an edge without going negative', () => {
    const flush = { x: 0, y: PHONE.height - 68, width: PHONE.width, height: 68 };
    for (const r of scrimRects(flush, PHONE)) {
      expect(r.width).toBeGreaterThanOrEqual(0);
      expect(r.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('calloutPlacement', () => {
  it('prefers below when there is room', () => {
    const hole = { x: 20, y: 120, width: 350, height: 60 };
    const { placement, top } = calloutPlacement(hole, PHONE, 260, NO_INSETS);
    expect(placement).toBe('below');
    expect(top).toBe(hole.y + hole.height + CALLOUT_GAP);
  });

  it('goes above for the tab bar, which has nothing below it', () => {
    const tabBar = { x: 0, y: PHONE.height - 68, width: PHONE.width, height: 68 };
    const { placement, top } = calloutPlacement(tabBar, PHONE, 260, NO_INSETS);
    expect(placement).toBe('above');
    expect(top).toBe(tabBar.y - CALLOUT_GAP - 260);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('centres when neither side fits', () => {
    const tall = { x: 0, y: 40, width: PHONE.width, height: PHONE.height - 80 };
    expect(calloutPlacement(tall, PHONE, 400, NO_INSETS).placement).toBe('centre');
  });

  it('centres when there is no target at all', () => {
    // The welcome step, and the fallback whenever an anchor can't be measured.
    const { placement, top } = calloutPlacement(null, PHONE, 260, NO_INSETS);
    expect(placement).toBe('centre');
    expect(top).toBe(Math.round((PHONE.height - 260) / 2));
  });

  it('respects the safe area', () => {
    const insets = { top: 59, bottom: 34 };
    const nearBottom = { x: 0, y: 600, width: PHONE.width, height: 60 };
    // 844 - 34 - (660 + 12) = 138 below, so a 200pt callout must go above.
    const { placement } = calloutPlacement(nearBottom, PHONE, 200, insets);
    expect(placement).toBe('above');

    // A hole tucked under the notch leaves no room above either.
    const nearTop = { x: 0, y: 70, width: PHONE.width, height: 40 };
    expect(calloutPlacement(nearTop, PHONE, 200, insets).placement).toBe('below');
  });
});

describe('calloutFrame', () => {
  it('fills the width minus gutters on a phone', () => {
    const { left, width } = calloutFrame(PHONE);
    expect(width).toBe(PHONE.width - 32);
    expect(left).toBe(16);
  });

  it('caps and centres at desktop widths', () => {
    // apps/mobile also runs in a browser at app.snaghq.co.nz, where a
    // full-bleed instruction card reads as a banner, not as a pointer.
    const desktop = { width: 1440, height: 900 };
    const { left, width } = calloutFrame(desktop);
    expect(width).toBe(CALLOUT_MAX_WIDTH);
    expect(left).toBe(Math.round((1440 - CALLOUT_MAX_WIDTH) / 2));
  });
});

describe('isUsableTarget', () => {
  it('rejects a zero-size rect', () => {
    // What a control measures as mid-mount.
    expect(isUsableTarget({ x: 0, y: 0, width: 0, height: 0 }, PHONE)).toBe(false);
  });

  it('rejects a control scrolled off the screen', () => {
    // Real coordinates, simply not on screen — a hole here spotlights nothing.
    expect(isUsableTarget({ x: 20, y: 1200, width: 200, height: 40 }, PHONE)).toBe(false);
    expect(isUsableTarget({ x: 20, y: -300, width: 200, height: 40 }, PHONE)).toBe(false);
  });

  it('accepts a partly visible control', () => {
    expect(isUsableTarget({ x: 20, y: 820, width: 200, height: 40 }, PHONE)).toBe(true);
  });

  it('rejects null', () => {
    expect(isUsableTarget(null, PHONE)).toBe(false);
  });
});
