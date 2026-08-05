import AsyncStorage from '@react-native-async-storage/async-storage';

import { readTourState, resolveTourState, writeTourState } from './tourState';

const store = AsyncStorage as unknown as { __reset: () => void };

// Two ways to get a resumable walkthrough wrong, and both are worse than not
// having one: restarting somebody at step 1 after they got to step 14, and
// replaying a finished walkthrough on a second device.

beforeEach(() => store.__reset());

describe('the local mirror', () => {
  it('round-trips a paused step', async () => {
    await writeTourState('u1', 'paused', 'report-photo');
    const state = await readTourState('u1');
    expect(state?.status).toBe('paused');
    expect(state?.stepId).toBe('report-photo');
    expect(Date.parse(state!.updatedAt)).not.toBeNaN();
  });

  it('keeps each user separate, for shared devices', async () => {
    await writeTourState('u1', 'paused', 'report-photo');
    expect(await readTourState('u2')).toBeNull();
  });

  it('writes and reads nothing for an unknown user', async () => {
    await writeTourState(null, 'running', 'welcome');
    expect(await readTourState(null)).toBeNull();
    expect(await readTourState('u1')).toBeNull();
  });

  it('treats unparseable stored data as absent', async () => {
    await AsyncStorage.setItem('snag.tour.u1', 'not json');
    expect(await readTourState('u1')).toBeNull();
  });
});

describe('resolveTourState', () => {
  const server = (status: string, stepId: string | null, updatedAt: string | null) =>
    ({ status, stepId, updatedAt }) as Parameters<typeof resolveTourState>[0];
  const local = (status: string, stepId: string | null, updatedAt: string) =>
    ({ status, stepId, updatedAt }) as Parameters<typeof resolveTourState>[1];

  it('uses the server when there is no mirror', () => {
    expect(resolveTourState(server('paused', 'snags-filters', '2026-08-01T00:00:00Z'), null)).toEqual({
      status: 'paused',
      stepId: 'snags-filters',
    });
  });

  it('starts from scratch when neither side knows anything', () => {
    expect(resolveTourState(null, null)).toEqual({ status: 'not_started', stepId: null });
  });

  it('prefers the mirror when it is newer', () => {
    // Paused on a site with no signal: the server still says not_started, and
    // believing it would restart a first-time walkthrough from step one.
    const resolved = resolveTourState(
      server('not_started', null, null),
      local('paused', 'report-kind', '2026-08-05T10:00:00Z'),
    );
    expect(resolved).toEqual({ status: 'paused', stepId: 'report-kind' });
  });

  it('prefers the server when it is newer', () => {
    // Carried on from another device. This one's mirror is stale.
    const resolved = resolveTourState(
      server('running', 'documents', '2026-08-05T12:00:00Z'),
      local('paused', 'report-kind', '2026-08-05T10:00:00Z'),
    );
    expect(resolved).toEqual({ status: 'running', stepId: 'documents' });
  });

  it('lets a finish on either side win, whatever the timestamps say', () => {
    // Absorbing on purpose: replaying something you finished costs one tap on
    // Profile, and the reverse mistake reruns a whole walkthrough unasked.
    expect(
      resolveTourState(
        server('done', null, '2026-08-01T00:00:00Z'),
        local('running', 'welcome', '2026-08-05T10:00:00Z'),
      ),
    ).toEqual({ status: 'done', stepId: null });

    expect(
      resolveTourState(
        server('running', 'welcome', '2026-08-05T10:00:00Z'),
        local('done', null, '2026-08-01T00:00:00Z'),
      ),
    ).toEqual({ status: 'done', stepId: null });
  });
});
