import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which list's folds these are. Three surfaces fold rooms away now — the list's
 * own sections, the shopping card inside it, and the House tab — and they are
 * deliberately separate: folding the Garage away on the House tab is a
 * statement about the record you are reading, not about the jobs filed there,
 * and one key would have each surface silently reaching into the others.
 *
 * Namespacing here rather than in three callers keeps the guards in one place:
 * every read and write below has to survive storage being absent, full or
 * throwing, and that is not a thing to copy out three times.
 */
export type CollapseScope = 'list' | 'shopping' | 'house';

const KEYS: Record<CollapseScope, string> = {
  list: 'snag.list.collapsed',
  shopping: 'snag.shopping.collapsed',
  house: 'snag.house.collapsed',
};

/**
 * Which sections of the list somebody has folded away.
 *
 * **Per device, not per account, and deliberately.** This is where you are in a
 * list rather than a fact about the house: the other person folding the Garage
 * away on their phone must not fold it away on yours, and there is nothing here
 * worth a column, an RPC and a round trip on every visit to the app's home
 * screen. It is the same argument that keeps a remembered filter out of the
 * schema.
 *
 * **Every read and write is guarded.** Storage can be absent, full, or throw
 * outright — a private window, cleared site data, a browser with storage
 * blocked — and a list that will not render because it could not remember which
 * room was folded is a far worse outcome than a list that opens expanded.
 * Failure is always "everything is open", which is the default anyway.
 *
 * Keyed by section rather than by index, because the sections a list has change
 * as work is filed and finished: fold the Garage away, finish everything in the
 * Bathroom, and an index would fold whatever slid into that position.
 */
export async function readCollapsed(scope: CollapseScope = 'list'): Promise<string[]> {
  const KEY = KEYS[scope];
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(KEY) ?? null
      : await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Anything but a list of strings is something else's key, or a version of
    // ours from before. Neither is worth reporting; both mean "open".
    return Array.isArray(parsed) ? parsed.filter((one) => typeof one === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeCollapsed(
  keys: string[],
  scope: CollapseScope = 'list',
): Promise<void> {
  const KEY = KEYS[scope];
  try {
    const raw = JSON.stringify(keys);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, raw);
    else await AsyncStorage.setItem(KEY, raw);
  } catch {
    // Folding a room away is not worth an alert, and a quota error here means
    // the fold is forgotten rather than anything being lost.
  }
}
