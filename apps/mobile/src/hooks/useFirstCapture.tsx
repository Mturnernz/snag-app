import React, { createContext, useContext, useMemo, useRef } from 'react';

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
 */
interface FirstCapture {
  take: () => string | null;
}

const FirstCaptureContext = createContext<FirstCapture>({ take: () => null });

export function FirstCaptureProvider({
  uri, children,
}: {
  uri: string | null;
  children: React.ReactNode;
}) {
  const held = useRef(uri);
  const value = useMemo<FirstCapture>(() => ({
    take: () => {
      const next = held.current;
      held.current = null;
      return next;
    },
  }), []);
  return <FirstCaptureContext.Provider value={value}>{children}</FirstCaptureContext.Provider>;
}

export function useFirstCapture(): FirstCapture {
  return useContext(FirstCaptureContext);
}
