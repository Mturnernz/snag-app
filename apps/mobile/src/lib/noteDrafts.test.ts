import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTE_DRAFT_DAYS, readNoteDraft, writeNoteDraft } from './noteDrafts';

const T0 = Date.UTC(2026, 8, 30, 9, 0);
const DAY = 86_400_000;

beforeEach(async () => { await AsyncStorage.clear(); });

describe('note drafts', () => {
  it('keeps a draft per job and gives it back', async () => {
    await writeNoteDraft('a', 'Ordered the seal', T0);
    await writeNoteDraft('b', 'Gutters', T0);
    expect(await readNoteDraft('a', T0)).toBe('Ordered the seal');
    expect(await readNoteDraft('b', T0)).toBe('Gutters');
    expect(await readNoteDraft('c', T0)).toBe('');
  });

  it('forgets a draft written empty', async () => {
    await writeNoteDraft('a', 'Ordered the seal', T0);
    await writeNoteDraft('a', '   ', T0);
    expect(await readNoteDraft('a', T0)).toBe('');
    expect(await AsyncStorage.getItem('snag.note-draft.a')).toBeNull();
  });

  it('lets a month-old draft go', async () => {
    await writeNoteDraft('a', 'Ordered the seal', T0);
    expect(await readNoteDraft('a', T0 + (NOTE_DRAFT_DAYS - 1) * DAY)).toBe('Ordered the seal');
    expect(await readNoteDraft('a', T0 + (NOTE_DRAFT_DAYS + 1) * DAY)).toBe('');
    expect(await AsyncStorage.getItem('snag.note-draft.a')).toBeNull();
  });

  it('reads anything that is not a draft of ours as no draft', async () => {
    await AsyncStorage.setItem('snag.note-draft.a', 'not json');
    expect(await readNoteDraft('a', T0)).toBe('');
    await AsyncStorage.setItem('snag.note-draft.a', JSON.stringify(['x']));
    expect(await readNoteDraft('a', T0)).toBe('');
  });
});
