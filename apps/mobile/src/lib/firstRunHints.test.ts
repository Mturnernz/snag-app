import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldShowHint, markHintSeen } from './firstRunHints';

const store = AsyncStorage as unknown as { __reset: () => void };

// A hint is spent the first time it is shown, so the two ways of getting it
// wrong are both permanent: showing it forever, or burning it on nobody.

beforeEach(() => store.__reset());

describe('firstRunHints', () => {
  it('shows a hint once, then never again', async () => {
    expect(await shouldShowHint('managerTab', 'u1')).toBe(true);
    await markHintSeen('managerTab', 'u1');
    expect(await shouldShowHint('managerTab', 'u1')).toBe(false);
  });

  it('keeps each hint independent', async () => {
    await markHintSeen('managerTab', 'u1');
    expect(await shouldShowHint('seriousReport', 'u1')).toBe(true);
  });

  it('keeps each user independent, for shared devices', async () => {
    await markHintSeen('seriousReport', 'u1');
    expect(await shouldShowHint('seriousReport', 'u2')).toBe(true);
  });

  it('shows nothing when the user is unknown, and spends nothing', async () => {
    // A hint burned before the session resolves is spent on nobody — the user
    // it was meant for would never see it.
    expect(await shouldShowHint('managerTab', null)).toBe(false);
    await markHintSeen('managerTab', null);
    expect(await shouldShowHint('managerTab', 'u1')).toBe(true);
  });
});
