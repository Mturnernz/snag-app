import React, { createContext, useContext, useMemo, useRef } from 'react';

/**
 * What the tour's *Try it* asked for: the thing to open once the app is up.
 * `logJob` is the list's capture sheet; the other two are the House tab's.
 */
export type FirstAction = 'addRoom' | 'addThing' | 'logJob';

/**
 * A photograph taken on the last screen of first-run setup, waiting for the
 * list to file it.
 *
 * It is taken there rather than on the list because a browser opens the
 * camera only from inside a tap: *Snap your first job* has to call the camera
 * in its own press handler, and by the time the list has mounted that tap is
 * long over. So setup takes the picture and hands it on, and the list files it
 * through `fileCapturedPhoto` — the shutter's own path — once there is a place
 * to file it against. Taken once: `take` empties it, so a second mount of the
 * list cannot file the same photograph twice.
 *
 * **And what the tour's *Try it* asked for**, on the same terms: held until
 * the screen that does it takes it, and taken once. The list takes `logJob`
 * and sends the other two to the House tab, which takes them there — so
 * `peekAction` says what is waiting without spending it.
 */
interface FirstCapture {
  take: () => string | null;
  peekAction: () => FirstAction | null;
  /** The waiting action, if it is one of these; emptied when it is. */
  takeAction: (kinds: FirstAction[]) => FirstAction | null;
}

const FirstCaptureContext = createContext<FirstCapture>({
  take: () => null,
  peekAction: () => null,
  takeAction: () => null,
});

export function FirstCaptureProvider({
  uri, action = null, children,
}: {
  uri: string | null;
  action?: FirstAction | null;
  children: React.ReactNode;
}) {
  const held = useRef(uri);
  const heldAction = useRef<FirstAction | null>(action);
  const value = useMemo<FirstCapture>(() => ({
    take: () => {
      const next = held.current;
      held.current = null;
      return next;
    },
    peekAction: () => heldAction.current,
    takeAction: (kinds) => {
      const next = heldAction.current;
      if (!next || !kinds.includes(next)) return null;
      heldAction.current = null;
      return next;
    },
  }), []);
  return <FirstCaptureContext.Provider value={value}>{children}</FirstCaptureContext.Provider>;
}

export function useFirstCapture(): FirstCapture {
  return useContext(FirstCaptureContext);
}
