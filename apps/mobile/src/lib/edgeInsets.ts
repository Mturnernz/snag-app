import { Platform } from 'react-native';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * How far anything tappable must stand from the glass, on the phone in hand.
 *
 * `useSafeAreaInsets` answers what the *system* reports, and on both phones this
 * app is installed on that is not the same thing as where a thumb can press:
 *
 * - **Android, installed.** The manifest asks for `fullscreen`, so both system
 *   bars go and every inset is **zero** — the header's back arrow sat in the
 *   screen's rounded top corner beside the camera cut-out, and the tab bar's
 *   corner tabs in the rounded bottom ones, right where the swipe that brings
 *   the navigation bar back begins. Nothing reports a rounded corner.
 * - **iPhone.** The home indicator is reported (34pt) and the status bar sits
 *   above the page in `default` style, so the top is honest. But a phone with
 *   no home indicator, or any desktop browser, answers zero at the bottom, and
 *   a bottom sheet's button then sits on the very edge.
 *
 * So each edge is the larger of what the system says and a floor. The top floor
 * applies only in `fullscreen`, where the status bar is gone: anywhere else the
 * status bar is already above the page, and adding a band beneath it would
 * push every header down for nothing.
 */
export const EDGE_FLOOR = {
  /** Clears a rounded corner and a punch-hole camera with no status bar above. */
  topFullscreen: 28,
  /** Clears a rounded bottom corner and the start of the system swipe. */
  bottom: 16,
};

export type DisplayMode = 'fullscreen' | 'standalone' | 'browser';

export function edgeInsets(safe: Insets, mode: DisplayMode): Insets {
  return {
    top: mode === 'fullscreen' ? Math.max(safe.top, EDGE_FLOOR.topFullscreen) : safe.top,
    bottom: Math.max(safe.bottom, EDGE_FLOOR.bottom),
    left: safe.left,
    right: safe.right,
  };
}

/**
 * Whether the installed app is running with the system bars hidden. Asked of
 * the browser rather than assumed from the platform: the manifest's
 * `display_override` is a preference, and iOS has no fullscreen mode at all.
 */
export function currentDisplayMode(): DisplayMode {
  if (Platform.OS !== 'web') return 'standalone';
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'browser';
  try {
    if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  } catch {
    // A browser that cannot answer the question is a browser tab.
  }
  return 'browser';
}
