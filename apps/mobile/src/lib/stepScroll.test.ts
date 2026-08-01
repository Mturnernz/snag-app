import { stepScrollOffset, HEADROOM } from './stepScroll';

// Two coordinate spaces meet in this function, and the whole bug class is
// forgetting one of them: `stepY` is measured inside the content wrapper, but
// scrollTo wants an offset in the ScrollView. On a snag with a photo the two
// are 280px apart, and on a snag without one they're identical — which is why
// an implementation that ignores contentY looks correct on exactly half the
// snags you test it on.

describe('stepScrollOffset', () => {
  it('adds the content offset to the step offset', () => {
    // Hero photo above the content wrapper — the case where forgetting
    // contentY lands you a whole photo short of the card.
    expect(stepScrollOffset(300, 900)).toBe(1200 - HEADROOM);
  });

  it('handles a snag with no photo, where the content starts at zero', () => {
    expect(stepScrollOffset(0, 640)).toBe(640 - HEADROOM);
  });

  it('leaves headroom above the card', () => {
    expect(stepScrollOffset(0, 500)).toBeLessThan(500);
    expect(stepScrollOffset(0, 500, 40)).toBe(460);
  });

  it('never returns a negative offset', () => {
    // The first card can sit inside the headroom. A negative offset bounces the
    // scroll view on iOS rather than resting at the top.
    expect(stepScrollOffset(0, 0)).toBe(0);
    expect(stepScrollOffset(0, 5)).toBe(0);
    expect(stepScrollOffset(0, 500, 10_000)).toBe(0);
  });
});
