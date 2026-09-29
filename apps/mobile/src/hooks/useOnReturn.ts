import { useEffect, useRef } from 'react';
import { subscribeForeground } from '../lib/foreground';

/**
 * Runs `callback` when the app comes back to the front after being away for
 * at least `minAwayMs`. See `lib/foreground.ts` for why this exists.
 *
 * The callback is read fresh each time, so it can close over the screen's
 * current state without re-subscribing on every render.
 */
export function useOnReturn(callback: (awayMs: number) => void, minAwayMs: number): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => subscribeForeground((awayMs) => {
    if (awayMs >= minAwayMs) latest.current(awayMs);
  }), [minAwayMs]);
}
