import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which rooms the House tab's grid shows: the ones with something **recorded**
 * in them, or **all** of them, suggestions included.
 *
 * Per device, for `lib/collapsed.ts`'s reason: it is where somebody is in a
 * screen rather than a fact about the house. Every read and write is guarded
 * the same way, and failure is always the default, `recorded`.
 */
export type HouseView = 'recorded' | 'all';

const KEY = 'snag.house.view';

export async function readHouseView(): Promise<HouseView> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(KEY) ?? null
      : await AsyncStorage.getItem(KEY);
    return raw === 'all' ? 'all' : 'recorded';
  } catch {
    return 'recorded';
  }
}

export async function writeHouseView(view: HouseView): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, view);
    else await AsyncStorage.setItem(KEY, view);
  } catch {
    // Forgetting which rooms were showing costs nothing worth an alert.
  }
}
