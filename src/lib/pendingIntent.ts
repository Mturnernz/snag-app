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
  /** Captured up front by the sign-up flow so the post-auth resume step
   *  doesn't have to ask for it again. */
  name: string;
}

// The combined create-org screen collects the org name and the owner's name up
// front, so the organisation can be created automatically on first sign-in
// with no further screens.
export interface PendingCreate {
  orgName: string;
  name: string;
}

export async function setPendingJoin(join: PendingJoin) {
  await AsyncStorage.multiSet([[JOIN_KEY, JSON.stringify(join)], [CREATE_KEY, '']]);
}

export async function setPendingCreate(create: PendingCreate) {
  await AsyncStorage.multiSet([[CREATE_KEY, JSON.stringify(create)], [JOIN_KEY, '']]);
}

export async function getPendingIntent(): Promise<{ join: PendingJoin | null; create: PendingCreate | null }> {
  const [[, joinRaw], [, createRaw]] = await AsyncStorage.multiGet([JOIN_KEY, CREATE_KEY]);
  let join: PendingJoin | null = null;
  let create: PendingCreate | null = null;
  if (joinRaw) {
    try { join = JSON.parse(joinRaw); } catch { /* ignore */ }
  }
  if (createRaw) {
    try {
      const parsed = JSON.parse(createRaw);
      if (parsed && typeof parsed === 'object' && parsed.orgName) create = parsed;
    } catch { /* ignore legacy 'true' values */ }
  }
  return { join, create };
}

export async function clearPendingIntent() {
  await AsyncStorage.multiRemove([JOIN_KEY, CREATE_KEY]);
}
