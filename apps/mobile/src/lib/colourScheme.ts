import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SCHEME, isSchemeId, type SchemeId } from '../constants/schemes';

/**
 * Which colour scheme this device draws, and remembering a new one.
 *
 * **It has to be known before the first stylesheet is built.** Every screen's
 * `StyleSheet.create` reads `Colors` once, when its module loads, so a scheme
 * cannot be swapped under a running app — the styles already hold the old
 * hex values. So the scheme is read first and the app is loaded after it:
 *
 *   - **On the web build** `localStorage` answers synchronously, so this
 *     module reads it the moment it loads, before `theme.ts` builds `Colors`.
 *   - **On a phone** storage is asynchronous. `index.js` waits for
 *     `loadStoredScheme`, hands the answer to `setBootScheme`, and only then
 *     requires the app.
 *
 * Changing it reloads the page on the web; on a phone it takes effect the next
 * time the app opens, and the You tab says so rather than pretending.
 *
 * Every read and write is guarded, as `collapsed.ts`'s are, and failure is
 * always the default scheme: an app that will not open because it could not
 * remember a colour is far worse than one in fern.
 *
 * This module imports nothing from `constants/theme`, deliberately: it is
 * what `theme.ts` reads, so it must be loadable before it.
 */
const KEY = 'snag.colourScheme';

function readWebSync(): SchemeId | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = globalThis.localStorage?.getItem(KEY) ?? null;
    return isSchemeId(raw) ? raw : null;
  } catch {
    return null;
  }
}

let active: SchemeId = readWebSync() ?? DEFAULT_SCHEME;

/** The scheme `theme.ts` builds `Colors` from. */
export function activeSchemeId(): SchemeId {
  return active;
}

/** Native boot: the stored answer, set before the app's modules load. */
export function setBootScheme(id: SchemeId): void {
  active = id;
}

export async function loadStoredScheme(): Promise<SchemeId> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(KEY) ?? null
      : await AsyncStorage.getItem(KEY);
    return isSchemeId(raw) ? raw : DEFAULT_SCHEME;
  } catch {
    return DEFAULT_SCHEME;
  }
}

/**
 * Remembers a scheme. Resolves `'reloading'` on the web, where the page is
 * reloaded to draw it, and `'next-open'` on a phone.
 */
export async function chooseScheme(id: SchemeId): Promise<'reloading' | 'next-open'> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, id);
    else await AsyncStorage.setItem(KEY, id);
  } catch {
    // Storage full or refused: the choice simply is not kept.
  }
  if (Platform.OS === 'web') {
    try {
      globalThis.location?.reload();
    } catch {
      // A test, or a browser that will not: the next load draws it.
    }
    return 'reloading';
  }
  return 'next-open';
}
