import AsyncStorage from '@react-native-async-storage/async-storage';

// Captures what a first-time user set out to do on the login screen (scan a
// company QR / create an organisation) so that after sign-up — including the
// email-confirmation round trip — they land directly in that flow instead of
// the generic org-setup chooser.

const JOIN_KEY = 'snag.pendingJoin';
const CREATE_KEY = 'snag.pendingCreate';

export interface PendingJoin {
  code: string;
  orgName: string;
}

export async function setPendingJoin(join: PendingJoin) {
  await AsyncStorage.multiSet([[JOIN_KEY, JSON.stringify(join)], [CREATE_KEY, '']]);
}

export async function setPendingCreate() {
  await AsyncStorage.multiSet([[CREATE_KEY, 'true'], [JOIN_KEY, '']]);
}

export async function getPendingIntent(): Promise<{ join: PendingJoin | null; create: boolean }> {
  const [[, joinRaw], [, createRaw]] = await AsyncStorage.multiGet([JOIN_KEY, CREATE_KEY]);
  let join: PendingJoin | null = null;
  if (joinRaw) {
    try { join = JSON.parse(joinRaw); } catch { /* ignore */ }
  }
  return { join, create: createRaw === 'true' };
}

export async function clearPendingIntent() {
  await AsyncStorage.multiRemove([JOIN_KEY, CREATE_KEY]);
}
