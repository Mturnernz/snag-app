import AsyncStorage from '@react-native-async-storage/async-storage';
import { readLastSeen, markSeen } from './lastSeen';

const store = AsyncStorage as unknown as { __reset: () => void; __dump: () => Record<string, string> };

const ME = 'user-me';
const THEM = 'user-them';

beforeEach(() => store.__reset());

describe('lastSeen', () => {
  it('reads back what a visit wrote', async () => {
    await markSeen(ME, new Date('2026-08-01T09:00:00.000Z'));
    expect(await readLastSeen(ME)).toBe('2026-08-01T09:00:00.000Z');
  });

  it('reports no visit before there has been one', async () => {
    expect(await readLastSeen(ME)).toBeNull();
  });

  // A shared device is the case this guards. An unguarded write files one
  // person's visit under whoever signs in next — the same reason the filter
  // preferences are keyed per user rather than stored globally.
  it('keeps one user\'s visit out of another\'s', async () => {
    await markSeen(ME, new Date('2026-08-01T09:00:00.000Z'));
    expect(await readLastSeen(THEM)).toBeNull();
  });

  // Both halves no-op before the signed-in user resolves, rather than writing
  // to a key with "null" in it and stranding the real one.
  it('does nothing at all when the user id has not resolved yet', async () => {
    await markSeen(null, new Date('2026-08-01T09:00:00.000Z'));
    expect(store.__dump()).toEqual({});
    expect(await readLastSeen(null)).toBeNull();
  });

  it('moves the mark forward on a later visit', async () => {
    await markSeen(ME, new Date('2026-08-01T09:00:00.000Z'));
    await markSeen(ME, new Date('2026-08-02T09:00:00.000Z'));
    expect(await readLastSeen(ME)).toBe('2026-08-02T09:00:00.000Z');
  });
});
