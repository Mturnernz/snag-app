import { Platform } from 'react-native';

/**
 * Whether Snag is installed on this phone, and how it would be.
 *
 * Snag is installed from the browser, not a store, so somebody who opens
 * app.snaghq.co.nz in a tab has no way to know there is anything to install,
 * and the tab is the thing that gets closed and lost. The install card
 * (`components/InstallCard.tsx`) asks once, and this file is everything it
 * needs to know first, kept pure so jest can hold each rule.
 *
 * **Installed is a display mode, not a guess.** The manifest asks for
 * `fullscreen`, then `standalone` (`display_override`). A launch from the home
 * screen reports one of them to `matchMedia`, and iOS reports its own
 * `navigator.standalone`. A browser tab reports neither.
 */

export type InstallPlatform = 'ios' | 'android' | 'other';

interface DisplayEnv {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

export function isInstalled(env: DisplayEnv): boolean {
  if (env.navigator?.standalone === true) return true;
  const mm = env.matchMedia;
  if (!mm) return false;
  try {
    return (
      mm('(display-mode: standalone)').matches ||
      mm('(display-mode: fullscreen)').matches ||
      mm('(display-mode: minimal-ui)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Which set of steps to show.
 *
 * iPadOS reports itself as a Mac, so a "Macintosh" with a touch screen is an
 * iPad. Anything else that is not Android gets no steps, because a desktop
 * browser is not where anybody photographs a toilet seat.
 */
export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** Whether there is anything to say: the web build, in a browser tab, on a phone. */
export function shouldOfferInstall(args: {
  web: boolean;
  installed: boolean;
  platform: InstallPlatform;
  dismissed: boolean;
}): boolean {
  return args.web && !args.installed && args.platform !== 'other' && !args.dismissed;
}

/** The environment as the running app sees it. Web only; elsewhere, nothing to offer. */
export function currentInstallEnv(): { installed: boolean; platform: InstallPlatform } {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { installed: true, platform: 'other' };
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return {
    installed: isInstalled({
      matchMedia: window.matchMedia?.bind(window),
      navigator: nav,
    }),
    platform: installPlatform(nav.userAgent ?? '', nav.maxTouchPoints ?? 0),
  };
}

const DISMISSED_KEY = 'snag.install.dismissed';

/**
 * Whether the card was closed on this device.
 *
 * Guarded exactly as the list's folds are (`collapsed.ts`). Storage can be
 * absent, full or throwing, and failure means "not dismissed". The card
 * showing once more is a far smaller cost than a screen that will not render.
 */
export function readInstallDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

const VISITS_KEY = 'snag.install.visits';
/** The list's card waits for this many openings of the app before it asks. */
export const INSTALL_AFTER_VISITS = 3;
let countedThisLoad = false;

/**
 * How many times the app has been opened on this device, counting this one
 * once per page load.
 *
 * The card sat at the top of the list from the first minute, above the first
 * job, asking somebody who had not yet used the app to install it. It waits
 * for the third opening now: by then they know what they would be installing.
 * Where storage is absent or throws, the answer is "enough" — the card showing
 * is the smaller failure, as it is for a dismissal that cannot be remembered.
 */
export function countInstallVisit(): number {
  try {
    const store = globalThis.localStorage;
    if (!store) return INSTALL_AFTER_VISITS;
    const before = Number(store.getItem(VISITS_KEY)) || 0;
    if (countedThisLoad) return before;
    countedThisLoad = true;
    store.setItem(VISITS_KEY, String(before + 1));
    return before + 1;
  } catch {
    return INSTALL_AFTER_VISITS;
  }
}

/** For tests: forget that this load was counted. */
export function resetInstallVisitCount(): void {
  countedThisLoad = false;
}

export function writeInstallDismissed(): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, '1');
  } catch {
    // Forgetting a dismissal means seeing the card again, nothing worse.
  }
}
