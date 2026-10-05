import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which home this device was last showing — a household id, since a home is a
 * household and has one place.
 *
 * Per device, for `lib/collapsed.ts`'s reason: it is where somebody is, not a
 * fact about the house. Mike looking at the bach on his phone must not move
 * the laptop off the house. Every read and write is guarded the same way, and
 * failure is always "nothing remembered", which `useHousehold` answers with
 * the place they last filed a job against.
 */
const KEY = 'snag.home.current';

export async function readRememberedHousehold(): Promise<string | null> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(KEY) ?? null
      : await AsyncStorage.getItem(KEY);
    return raw || null;
  } catch {
    return null;
  }
}

export async function rememberHousehold(householdId: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, householdId);
    else await AsyncStorage.setItem(KEY, householdId);
  } catch {
    // Forgetting which home was showing costs one tap on the picker.
  }
}
