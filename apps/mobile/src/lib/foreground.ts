import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * When the app comes back to the front, and how long it was away.
 *
 * Snag is installed from the browser, and an installed web app is not closed
 * when somebody leaves it: it sits in the background for hours and comes back
 * exactly as it was. Nothing here used to notice. The list only reloaded when
 * somebody switched tabs, and pull-to-refresh is a no-op on the web build
 * (react-native-web's `RefreshControl` is a plain `View`), so the screen people
 * open most showed whatever was true when they last had it open — the other
 * person's new jobs missing, and photos whose links had expired drawn blank.
 * For a product whose only channel is this list, that is the one failure it
 * cannot have.
 *
 * On the web this is `visibilitychange` (the tab or the installed app hidden and
 * shown); on native it is `AppState`. Listeners get the time away, and decide
 * for themselves whether it was long enough to matter — a trip to the camera
 * hides the page too, and a screen must not reload itself under somebody who
 * has just taken a photo.
 */

/** Long enough away that a screen should read its data again. */
export const RETURN_RELOAD_MS = 60_000;

/**
 * Long enough away to count as a new visit: "New since you last looked" is
 * worked out again, as it is when the app is opened.
 */
export const NEW_VISIT_MS = 30 * 60_000;

/**
 * The away-time bookkeeping, apart from any event source so it can be
 * asserted. `hide` may be called more than once before `show` (native reports
 * `inactive` then `background`); the first one is when the person left.
 */
export function awayTracker(): { hide: (now: number) => void; show: (now: number) => number | null } {
  let hiddenAt: number | null = null;
  return {
    hide(now) {
      if (hiddenAt === null) hiddenAt = now;
    },
    show(now) {
      if (hiddenAt === null) return null;
      const away = Math.max(0, now - hiddenAt);
      hiddenAt = null;
      return away;
    },
  };
}

/** Whether the app is on screen right now. */
export function isForeground(): boolean {
  if (Platform.OS === 'web') {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }
  return AppState.currentState === 'active';
}

/** Calls `onReturn` with the time away whenever the app comes back to the front. */
export function subscribeForeground(onReturn: (awayMs: number) => void): () => void {
  const tracker = awayTracker();

  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return () => {};
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        tracker.hide(Date.now());
        return;
      }
      const away = tracker.show(Date.now());
      if (away !== null) onReturn(away);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }

  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') {
      tracker.hide(Date.now());
      return;
    }
    const away = tracker.show(Date.now());
    if (away !== null) onReturn(away);
  });
  return () => subscription.remove();
}
