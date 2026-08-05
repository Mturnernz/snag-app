import AsyncStorage from '@react-native-async-storage/async-storage';

import { TourStatus } from '../types';

// The guided walkthrough's resume point, on this device.
//
// The truth lives on `profiles` (`set_tour_progress`), because a paused
// walkthrough should survive a new phone and the web build. This is the mirror,
// and it earns its place in exactly one situation: somebody pauses on a site
// with no signal and reopens the app before it comes back. Without it the
// server read returns the last state that reached it — which for a walkthrough
// paused offline is `not_started`, and starting a first-time walkthrough over
// from step 1 is the single most irritating thing this feature could do.
//
// Keyed per user, like every other preference here, so a shared device does not
// resume one person's walkthrough for the next. Same guard as `firstRunHints`:
// nothing is read or written before the user id resolves.

export interface TourLocalState {
  status: TourStatus;
  /** A `TourStep['id']` from `@snag/onboarding-guide`, or null. */
  stepId: string | null;
  updatedAt: string;
}

const KEY_PREFIX = 'snag.tour.';

const keyFor = (userId: string) => KEY_PREFIX + userId;

export async function readTourState(userId: string | null): Promise<TourLocalState | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourLocalState>;
    if (!parsed || typeof parsed.status !== 'string') return null;
    return {
      status: parsed.status as TourStatus,
      stepId: typeof parsed.stepId === 'string' ? parsed.stepId : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    // A corrupt or unreadable mirror means we fall back to the server's answer,
    // which is the normal path anyway.
    return null;
  }
}

export async function writeTourState(
  userId: string | null,
  status: TourStatus,
  stepId: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    const state: TourLocalState = { status, stepId, updatedAt: new Date().toISOString() };
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state));
  } catch {
    // The server write is the one that matters; losing the mirror costs an
    // offline resume, not the walkthrough.
  }
}

/**
 * Which of the two answers to believe.
 *
 * The local mirror wins only when it is strictly newer than the server's, and
 * only when the server hasn't recorded a finish. `done` is deliberately
 * absorbing: a walkthrough completed on one device should not restart on
 * another because that device's mirror is stale, and the cost of the reverse
 * mistake — replaying something you've finished — is a tap on Profile.
 */
export function resolveTourState(
  server: { status: TourStatus; stepId: string | null; updatedAt: string | null } | null,
  local: TourLocalState | null,
): { status: TourStatus; stepId: string | null } {
  const serverState = server ?? { status: 'not_started' as TourStatus, stepId: null, updatedAt: null };
  if (!local) return { status: serverState.status, stepId: serverState.stepId };
  if (serverState.status === 'done') return { status: 'done', stepId: null };
  if (local.status === 'done') return { status: 'done', stepId: null };

  const serverAt = serverState.updatedAt ? Date.parse(serverState.updatedAt) : 0;
  const localAt = local.updatedAt ? Date.parse(local.updatedAt) : 0;
  if (Number.isFinite(localAt) && localAt > serverAt) {
    return { status: local.status, stepId: local.stepId };
  }
  return { status: serverState.status, stepId: serverState.stepId };
}
