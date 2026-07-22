import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as ImageManipulator from 'expo-image-manipulator';

import { createSnag, createPublicSnag, uploadSnagPhoto } from '../lib/supabase';
import {
  QueuedSnag,
  QueuedMemberSnag,
  QueuedPublicSnag,
  getQueuedSnags,
  enqueueSnag as enqueueSnagToStorage,
  removeQueuedSnag,
  markQueuedSnagFailed,
} from '../lib/offlineQueue';

type EnqueueEntry =
  | Omit<QueuedMemberSnag, 'id' | 'queuedAt' | 'attempts'>
  | Omit<QueuedPublicSnag, 'id' | 'queuedAt' | 'attempts'>;

interface OfflineQueueContextValue {
  pendingCount: number;
  syncing: boolean;
  isOffline: boolean;
  enqueue: (entry: EnqueueEntry) => Promise<void>;
  retryNow: () => void;
}

const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

// Compresses and uploads exactly like PhotoPicker's runUpload — kept in sync
// deliberately rather than shared, since PhotoPicker's version is tied to its
// per-photo status state and this one runs headless during a queue drain.
async function uploadQueuedPhoto(uri: string, pathPrefix: string): Promise<string | null> {
  const compressed = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  const fileName = `${pathPrefix}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  const { path } = await uploadSnagPhoto(compressed.uri, fileName);
  return path;
}

async function syncOne(item: QueuedSnag): Promise<void> {
  try {
    const photoPaths: string[] = [];
    for (const uri of item.photoUris) {
      const path = await uploadQueuedPhoto(uri, item.photoPathPrefix);
      if (path) photoPaths.push(path);
    }
    const { error } =
      item.type === 'member'
        ? await createSnag({ ...item.params, photoPaths, latitude: null, longitude: null })
        : await createPublicSnag({ ...item.params, photoPaths });
    if (error) throw error;
    await removeQueuedSnag(item.id);
  } catch (err: any) {
    await markQueuedSnagFailed(item.id, err?.message ?? 'Could not sync this report');
  }
}

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const drainingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    setPendingCount((await getQueuedSnags()).length);
  }, []);

  // Re-reads the queue fresh rather than closing over a stale snapshot, so
  // an item queued mid-drain (or one that failed and stays queued) is
  // handled correctly on the next pass without double-processing.
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setSyncing(true);
    try {
      const queue = await getQueuedSnags();
      for (const item of queue) {
        const net = await NetInfo.fetch();
        if (!net.isConnected) break;
        await syncOne(item);
      }
    } finally {
      drainingRef.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    // Fires immediately with the current state on subscribe, so this also
    // covers "already online at launch, sync whatever's left from last time".
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(!online);
      if (online) drain();
    });
    return () => unsubscribe();
  }, [refreshCount, drain]);

  const enqueue = useCallback(
    async (entry: EnqueueEntry) => {
      await enqueueSnagToStorage(entry);
      await refreshCount();
    },
    [refreshCount]
  );

  const retryNow = useCallback(() => {
    drain();
  }, [drain]);

  return (
    <OfflineQueueContext.Provider value={{ pendingCount, syncing, isOffline, enqueue, retryNow }}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue(): OfflineQueueContextValue {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) {
    throw new Error('useOfflineQueue must be used within an OfflineQueueProvider');
  }
  return ctx;
}
