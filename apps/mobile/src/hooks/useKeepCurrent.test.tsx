import React from 'react';
import TestRenderer from 'react-test-renderer';
import { cleanup, render } from '../test/render';
import { PHOTO_REFRESH_MS, useKeepCurrent } from './useKeepCurrent';

// An open job or thing page reads its photos again so the other phone's change
// reaches this one: on coming back to the app, and on a timer while it stays.
// Never while paused, and never while the app is in the background.

let mock_foreground = true;
let mock_onReturn: ((awayMs: number) => void) | null = null;
jest.mock('../lib/foreground', () => ({
  RETURN_RELOAD_MS: 60_000,
  isForeground: () => mock_foreground,
  subscribeForeground: (fn: (awayMs: number) => void) => {
    mock_onReturn = fn;
    return () => { mock_onReturn = null; };
  },
}));

function Probe({ refresh, paused }: { refresh: () => void; paused: boolean }) {
  useKeepCurrent(refresh, PHOTO_REFRESH_MS, paused);
  return null;
}

const mount = (refresh: () => void, paused = false) => {
  let r!: ReturnType<typeof render>;
  TestRenderer.act(() => { r = render(<Probe refresh={refresh} paused={paused} />); });
  return r;
};

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'Date',
      'performance', 'hrtime', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  mock_foreground = true;
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe('useKeepCurrent', () => {
  it('reads again every half minute while the page is in front', () => {
    const refresh = jest.fn();
    mount(refresh);
    jest.advanceTimersByTime(PHOTO_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(PHOTO_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not read while the app is in the background', () => {
    const refresh = jest.fn();
    mount(refresh);
    mock_foreground = false;
    jest.advanceTimersByTime(PHOTO_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads on coming back after a minute away, and not after a quick trip', () => {
    const refresh = jest.fn();
    mount(refresh);
    TestRenderer.act(() => { mock_onReturn!(5_000); });
    expect(refresh).not.toHaveBeenCalled();
    TestRenderer.act(() => { mock_onReturn!(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing while paused', () => {
    const refresh = jest.fn();
    mount(refresh, true);
    jest.advanceTimersByTime(PHOTO_REFRESH_MS * 3);
    TestRenderer.act(() => { mock_onReturn!(60_000); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when the page goes', () => {
    const refresh = jest.fn();
    const r = mount(refresh);
    TestRenderer.act(() => { r.unmount(); });
    jest.advanceTimersByTime(PHOTO_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});
