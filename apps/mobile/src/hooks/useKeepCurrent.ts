import { useEffect, useRef } from 'react';
import { useOnReturn } from './useOnReturn';
import { isForeground, RETURN_RELOAD_MS } from '../lib/foreground';

/**
 * How often an open job or thing page reads its photos again. A photo added or
 * taken off on the other phone reaches this one inside half a minute, for one
 * small read of one row.
 */
export const PHOTO_REFRESH_MS = 30_000;

/**
 * Runs `refresh` while a page is in front: when the app comes back after
 * `RETURN_RELOAD_MS` away, and every `everyMs` while it stays. Nothing while
 * `paused`, which is for the moments a re-read would land under somebody — a
 * write of their own in flight, or the photo viewer open on an index.
 *
 * The list does the same at its own pace (`LIST_REFRESH_MS`). There are no
 * notifications and no live connection here, so reading again is how one
 * person's change reaches the other's screen.
 */
export function useKeepCurrent(refresh: () => void, everyMs: number, paused = false): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  useOnReturn(() => {
    if (!paused) latest.current();
  }, RETURN_RELOAD_MS);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => {
      if (isForeground()) latest.current();
    }, everyMs);
    return () => clearInterval(timer);
  }, [paused, everyMs]);
}
