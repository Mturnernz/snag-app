import AsyncStorage from '@react-native-async-storage/async-storage';
import { SnagKind, SnagSeverity } from '../types';

// Persisted queue of snag creates captured while offline — capture only, per
// Phase 2.3's scope: no offline editing of investigations, no offline
// dashboard. Each entry carries local photo URIs (nothing has uploaded yet)
// plus whichever of createSnag/createPublicSnag's params it'll be replayed
// with once connectivity returns.

const QUEUE_KEY = 'snag.offlineQueue';

interface QueuedBase {
  id: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  photoUris: string[];
  /** Storage folder prefix — the org id for members, the reporter's own user
   *  id for public submissions. Matches PhotoPicker's pathPrefix prop. */
  photoPathPrefix: string;
}

export interface QueuedMemberSnag extends QueuedBase {
  type: 'member';
  params: {
    kind: SnagKind;
    description: string;
    severity: SnagSeverity | null;
    siteId: string;
    workGroupId?: string | null;
  };
}

export interface QueuedPublicSnag extends QueuedBase {
  type: 'public';
  params: {
    orgId: string;
    description: string;
    isHazard: boolean;
    reporterName: string | null;
  };
}

export type QueuedSnag = QueuedMemberSnag | QueuedPublicSnag;

async function readQueue(): Promise<QueuedSnag[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedSnag[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueuedSnags(): Promise<QueuedSnag[]> {
  return readQueue();
}

export async function enqueueSnag(
  entry:
    | Omit<QueuedMemberSnag, 'id' | 'queuedAt' | 'attempts'>
    | Omit<QueuedPublicSnag, 'id' | 'queuedAt' | 'attempts'>
): Promise<QueuedSnag> {
  const queue = await readQueue();
  const item = {
    ...entry,
    id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  } as QueuedSnag;
  queue.push(item);
  await writeQueue(queue);
  return item;
}

export async function removeQueuedSnag(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((q) => q.id !== id));
}

export async function markQueuedSnagFailed(id: string, message: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((q) => (q.id === id ? { ...q, attempts: q.attempts + 1, lastError: message } : q))
  );
}
