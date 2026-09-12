import { Platform } from 'react-native';

/**
 * How much of the window the on-screen keyboard is covering, on web.
 *
 * **`KeyboardAvoidingView` does nothing in a browser.** react-native-web ships
 * it, so it type-checks and renders, but its `onKeyboardChange` is an empty
 * method body and `Keyboard.isVisible()` returns a hardcoded `false` — the
 * `Keyboard` module is a stub with no events behind it. Seven screens in this
 * app wrap themselves in one. On a phone that works; on the build people
 * actually install it has never done anything at all, and nothing says so.
 *
 * Nobody has hit it hard yet only because every text field in the app sits near
 * the top of its screen. Anything pinned to the bottom — a primary action, a
 * comment box, a compose bar — sits behind the keyboard the moment someone
 * types.
 *
 * ## The two mechanisms, and why they compose
 *
 * There are two ways a browser can make room, and this app uses both because
 * neither covers every platform:
 *
 * 1. **`interactive-widget=resizes-content`** in the viewport meta (see
 *    `public/index.html`). Chrome shrinks the *layout* viewport when the
 *    keyboard opens, so ordinary layout already avoids it. Safari ignores the
 *    directive entirely.
 * 2. **`visualViewport`**, measured here. Available on iOS, where the layout
 *    viewport does not move and the page is scrolled instead.
 *
 * They can't double up, which is the useful part: when the layout viewport has
 * already shrunk, `innerHeight` shrinks with it and the sum below comes out at
 * zero. So whichever mechanism is doing the work, the other reports nothing.
 */

/** Nothing shorter than this is a keyboard. Keeps browser chrome out of it. */
const KEYBOARD_MIN_PX = 60;

interface VisualViewportLike {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface WindowLike {
  innerHeight: number;
  visualViewport?: VisualViewportLike;
  requestAnimationFrame?: (cb: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

const getWindow = (): WindowLike | undefined =>
  (globalThis as unknown as { window?: WindowLike }).window;

function measure(): number {
  const win = getWindow();
  const viewport = win?.visualViewport;
  if (!win || !viewport) return 0;

  // `offsetTop` matters as much as `height`: iOS pans the visual viewport
  // rather than resizing the layout one, so a focused field near the bottom
  // leaves the viewport both shorter *and* pushed down the page.
  const covered = win.innerHeight - (viewport.height + viewport.offsetTop);
  return covered >= KEYBOARD_MIN_PX ? Math.round(covered) : 0;
}

/** The inset right now. 0 on native, where the real Keyboard module works. */
export function currentKeyboardInset(): number {
  if (Platform.OS !== 'web') return 0;
  return measure();
}

/**
 * Calls back whenever the covered height changes, and returns an unsubscribe.
 *
 * Emits only on a change, and coalesces to one frame: `scroll` on the visual
 * viewport fires continuously while iOS settles the keyboard animation, and
 * re-rendering a pinned bar on every one of those is visible as jitter.
 */
export function subscribeKeyboardInset(onChange: (inset: number) => void): () => void {
  if (Platform.OS !== 'web') return () => {};

  const win = getWindow();
  const viewport = win?.visualViewport;
  if (!win || !viewport) return () => {};

  let last = measure();
  let scheduled = false;
  let frame: number | null = null;

  const emit = () => {
    scheduled = false;
    const next = measure();
    if (next === last) return;
    last = next;
    onChange(next);
  };

  // The flag rather than the handle decides whether a frame is already pending.
  // A `requestAnimationFrame` that runs its callback synchronously — a polyfill,
  // a test double — returns *after* the callback has finished, so clearing the
  // handle inside the callback and then assigning it here leaves a stale value
  // behind and every later change is swallowed.
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (win.requestAnimationFrame) frame = win.requestAnimationFrame(emit);
    else emit();
  };

  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);

  return () => {
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    if (scheduled && frame !== null) win.cancelAnimationFrame?.(frame);
  };
}
