import { Platform } from 'react-native';
import { currentKeyboardInset, subscribeKeyboardInset } from './keyboardInset';

// `KeyboardAvoidingView` is a no-op in a browser — react-native-web's
// `onKeyboardChange` is an empty method and `Keyboard.isVisible()` is a
// hardcoded `false`. This is what stands in for it, so what matters is that it
// measures the right thing on iOS (where the viewport is panned, not resized),
// reports nothing when the layout viewport has already made room, and never
// mistakes browser chrome for a keyboard.

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const setPlatform = (os: string) => {
  (Platform as unknown as { OS: string }).OS = os;
};

type Listener = () => void;

function fakeWindow({ innerHeight = 800, height = 800, offsetTop = 0, viewport = true } = {}) {
  const listeners: Record<string, Listener[]> = {};
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
    },
  };
  const win = {
    innerHeight,
    visualViewport: viewport ? vv : undefined,
    // Synchronous, so a test doesn't have to wait a frame to see the effect.
    requestAnimationFrame: (cb: () => void) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  (global as unknown as { window: unknown }).window = win;
  return {
    win,
    vv,
    fire: (type: string) => (listeners[type] ?? []).forEach((l) => l()),
    listenerCount: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
  };
}

beforeEach(() => setPlatform('web'));

describe('currentKeyboardInset', () => {
  it('is zero with the keyboard down', () => {
    fakeWindow({ innerHeight: 800, height: 800 });
    expect(currentKeyboardInset()).toBe(0);
  });

  it('measures a shortened viewport', () => {
    fakeWindow({ innerHeight: 800, height: 480 });
    expect(currentKeyboardInset()).toBe(320);
  });

  it('counts the offset too, because iOS pans rather than resizes', () => {
    // Same visible height, but the viewport has been pushed down the page to
    // keep a focused field above the keyboard. Height alone would say 250.
    fakeWindow({ innerHeight: 800, height: 550, offsetTop: 70 });
    expect(currentKeyboardInset()).toBe(180);
  });

  it('ignores a shift too small to be a keyboard', () => {
    // A browser toolbar collapsing, not a keyboard opening.
    fakeWindow({ innerHeight: 800, height: 756 });
    expect(currentKeyboardInset()).toBe(0);
  });

  it('reports nothing once the layout viewport has already made room', () => {
    // interactive-widget=resizes-content shrinks innerHeight with it, so the
    // two mechanisms can never double up.
    fakeWindow({ innerHeight: 480, height: 480 });
    expect(currentKeyboardInset()).toBe(0);
  });

  it('is zero on a phone, where KeyboardAvoidingView is real', () => {
    fakeWindow({ innerHeight: 800, height: 480 });
    setPlatform('ios');
    expect(currentKeyboardInset()).toBe(0);
  });

  it('survives a browser with no visualViewport', () => {
    fakeWindow({ viewport: false });
    expect(currentKeyboardInset()).toBe(0);
  });
});

describe('subscribeKeyboardInset', () => {
  it('reports a change, once, and only when the value moves', () => {
    const w = fakeWindow({ innerHeight: 800, height: 800 });
    const onChange = jest.fn();
    subscribeKeyboardInset(onChange);

    w.vv.height = 480;
    w.fire('resize');
    expect(onChange).toHaveBeenCalledWith(320);

    // Same measurement arriving again — scroll fires continuously while iOS
    // settles the keyboard animation, and re-rendering a pinned bar on each
    // one is visible as jitter.
    w.fire('scroll');
    w.fire('resize');
    expect(onChange).toHaveBeenCalledTimes(1);

    w.vv.height = 800;
    w.fire('resize');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('unsubscribes cleanly', () => {
    const w = fakeWindow();
    const stop = subscribeKeyboardInset(jest.fn());
    expect(w.listenerCount()).toBe(2);
    stop();
    expect(w.listenerCount()).toBe(0);
  });

  it('is inert on native and without a visualViewport', () => {
    const onChange = jest.fn();
    const w = fakeWindow({ innerHeight: 800, height: 480 });
    setPlatform('ios');
    subscribeKeyboardInset(onChange)();
    expect(w.listenerCount()).toBe(0);

    setPlatform('web');
    fakeWindow({ viewport: false });
    expect(() => subscribeKeyboardInset(onChange)()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
