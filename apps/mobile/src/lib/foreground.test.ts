import { awayTracker, NEW_VISIT_MS, RETURN_RELOAD_MS } from './foreground';

describe('awayTracker', () => {
  it('says how long the app was away', () => {
    const tracker = awayTracker();
    tracker.hide(1_000);
    expect(tracker.show(91_000)).toBe(90_000);
  });

  it('counts from the first time it was hidden', () => {
    // Native reports `inactive` and then `background`: the person left at the
    // first one.
    const tracker = awayTracker();
    tracker.hide(1_000);
    tracker.hide(5_000);
    expect(tracker.show(61_000)).toBe(60_000);
  });

  it('reports nothing for a show that was never preceded by a hide', () => {
    const tracker = awayTracker();
    expect(tracker.show(10_000)).toBeNull();
    tracker.hide(10_000);
    tracker.show(20_000);
    expect(tracker.show(30_000)).toBeNull();
  });

  it('never reports a negative time away', () => {
    const tracker = awayTracker();
    tracker.hide(50_000);
    expect(tracker.show(40_000)).toBe(0);
  });

  it('reloads after a minute away, and counts a new visit after half an hour', () => {
    // A trip to the camera hides the page too; a minute is longer than most,
    // and the reload under it is harmless when it is not.
    expect(RETURN_RELOAD_MS).toBe(60_000);
    expect(NEW_VISIT_MS).toBe(30 * 60_000);
  });
});
