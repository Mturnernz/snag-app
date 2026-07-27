import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueSnag,
  getQueuedSnags,
  markQueuedSnagFailed,
  removeQueuedSnag,
  type QueuedMemberSnag,
  type QueuedPublicSnag,
} from './offlineQueue';

const QUEUE_KEY = 'snag.offlineQueue';

// The queue holds snags a worker captured with no connectivity — reports that
// exist nowhere else yet. Losing or corrupting an entry loses a field report,
// so the behaviour worth pinning down is that entries survive, replay in order,
// and that a malformed store degrades to empty rather than throwing on a screen.

const reset = () => (AsyncStorage as unknown as { __reset: () => void }).__reset();
const dump = () => (AsyncStorage as unknown as { __dump: () => Record<string, string> }).__dump();

const memberEntry = (description: string): Omit<QueuedMemberSnag, 'id' | 'queuedAt' | 'attempts'> => ({
  type: 'member',
  photoUris: ['file:///tmp/a.jpg'],
  photoPathPrefix: 'org-1',
  params: {
    kind: 'fixit',
    description,
    severity: null,
    siteId: 'site-1',
  },
});

const publicEntry = (description: string): Omit<QueuedPublicSnag, 'id' | 'queuedAt' | 'attempts'> => ({
  type: 'public',
  photoUris: [],
  photoPathPrefix: 'user-9',
  params: { orgId: 'org-1', description, isHazard: true, reporterName: 'Passer By' },
});

beforeEach(reset);

describe('getQueuedSnags', () => {
  it('is empty before anything is queued', async () => {
    await expect(getQueuedSnags()).resolves.toEqual([]);
  });

  it('returns [] rather than throwing when the stored value is not JSON', async () => {
    // A screen renders straight off this. A parse error must not surface there.
    await AsyncStorage.setItem(QUEUE_KEY, 'not-json{');
    await expect(getQueuedSnags()).resolves.toEqual([]);
  });

  it('returns [] when the stored JSON is not an array', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({ nope: true }));
    await expect(getQueuedSnags()).resolves.toEqual([]);
  });
});

describe('enqueueSnag', () => {
  it('stamps an id, a queuedAt timestamp, and zero attempts', async () => {
    const item = await enqueueSnag(memberEntry('Broken fire door'));

    expect(item.id).toBeTruthy();
    expect(item.attempts).toBe(0);
    expect(Number.isNaN(Date.parse(item.queuedAt))).toBe(false);
  });

  it('persists the entry so it survives a fresh read', async () => {
    await enqueueSnag(memberEntry('Broken fire door'));

    const [stored] = await getQueuedSnags();
    expect(stored.type).toBe('member');
    expect(stored.params.description).toBe('Broken fire door');
    // Local photo URIs matter: nothing has uploaded yet, so losing them loses
    // the evidence the reporter attached.
    expect(stored.photoUris).toEqual(['file:///tmp/a.jpg']);
    expect(stored.photoPathPrefix).toBe('org-1');
  });

  it('appends rather than overwriting, preserving capture order', async () => {
    await enqueueSnag(memberEntry('first'));
    await enqueueSnag(memberEntry('second'));
    await enqueueSnag(memberEntry('third'));

    const queue = await getQueuedSnags();
    expect(queue).toHaveLength(3);
    expect(queue.map((q) => q.params.description)).toEqual(['first', 'second', 'third']);
  });

  it('gives concurrent entries distinct ids', async () => {
    // ids are `Date.now()` plus a random suffix, so same-millisecond captures
    // are exactly the case that could collide — and a collision would make
    // removeQueuedSnag delete two reports instead of one.
    const items = await Promise.all(
      Array.from({ length: 25 }, (_, i) => enqueueSnag(memberEntry(`snag ${i}`)))
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('keeps member and public entries side by side', async () => {
    await enqueueSnag(memberEntry('member one'));
    await enqueueSnag(publicEntry('public one'));

    const queue = await getQueuedSnags();
    expect(queue.map((q) => q.type)).toEqual(['member', 'public']);

    const pub = queue[1] as QueuedPublicSnag;
    expect(pub.params.orgId).toBe('org-1');
    expect(pub.params.isHazard).toBe(true);
    expect(pub.params.reporterName).toBe('Passer By');
  });

  it('writes valid JSON to a single storage key', async () => {
    await enqueueSnag(memberEntry('only one'));

    const keys = Object.keys(dump());
    expect(keys).toEqual([QUEUE_KEY]);
    expect(() => JSON.parse(dump()[QUEUE_KEY])).not.toThrow();
  });
});

describe('removeQueuedSnag', () => {
  it('removes only the matching entry', async () => {
    const a = await enqueueSnag(memberEntry('keep me'));
    const b = await enqueueSnag(memberEntry('remove me'));

    await removeQueuedSnag(b.id);

    const queue = await getQueuedSnags();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(a.id);
  });

  it('is a no-op for an unknown id', async () => {
    await enqueueSnag(memberEntry('keep me'));
    await removeQueuedSnag('no-such-id');
    await expect(getQueuedSnags()).resolves.toHaveLength(1);
  });

  it('empties the queue once every entry is removed', async () => {
    const a = await enqueueSnag(memberEntry('one'));
    const b = await enqueueSnag(memberEntry('two'));

    await removeQueuedSnag(a.id);
    await removeQueuedSnag(b.id);

    await expect(getQueuedSnags()).resolves.toEqual([]);
  });
});

describe('markQueuedSnagFailed', () => {
  it('increments attempts and records the error', async () => {
    const item = await enqueueSnag(memberEntry('flaky upload'));

    await markQueuedSnagFailed(item.id, 'network unreachable');

    const [stored] = await getQueuedSnags();
    expect(stored.attempts).toBe(1);
    expect(stored.lastError).toBe('network unreachable');
  });

  it('accumulates attempts across repeated failures', async () => {
    const item = await enqueueSnag(memberEntry('flaky upload'));

    await markQueuedSnagFailed(item.id, 'first failure');
    await markQueuedSnagFailed(item.id, 'second failure');
    await markQueuedSnagFailed(item.id, 'third failure');

    const [stored] = await getQueuedSnags();
    expect(stored.attempts).toBe(3);
    // Latest error wins — a stale message would misreport why it's stuck.
    expect(stored.lastError).toBe('third failure');
  });

  it('never drops the entry it is marking', async () => {
    // A failed replay must keep the report queued for a later retry.
    const item = await enqueueSnag(memberEntry('do not lose me'));
    await markQueuedSnagFailed(item.id, 'boom');

    const queue = await getQueuedSnags();
    expect(queue).toHaveLength(1);
    expect(queue[0].params.description).toBe('do not lose me');
  });

  it('leaves other entries untouched', async () => {
    const a = await enqueueSnag(memberEntry('untouched'));
    const b = await enqueueSnag(memberEntry('failing'));

    await markQueuedSnagFailed(b.id, 'boom');

    const queue = await getQueuedSnags();
    expect(queue.find((q) => q.id === a.id)!.attempts).toBe(0);
    expect(queue.find((q) => q.id === a.id)!.lastError).toBeUndefined();
  });

  it('is a no-op for an unknown id', async () => {
    await enqueueSnag(memberEntry('one'));
    await markQueuedSnagFailed('no-such-id', 'boom');

    const queue = await getQueuedSnags();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(0);
  });
});
