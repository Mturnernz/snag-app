import { useCallback, useEffect, useRef, useState } from 'react';
import { HOUSEHOLD_FILES_BUCKET, refreshFileUrl } from '../lib/supabase';
import { pathFromSignedUrl } from '../lib/signedUrls';

/**
 * A signed photo link that mends itself once.
 *
 * An `<Image>` whose link has expired used to render nothing and say nothing —
 * a blank tile where the photograph of the problem should be, which on a list
 * whose photos *are* the jobs reads as the job having lost its picture. So the
 * first failure asks for a new link, read back out of the old one's path, and
 * tries again. A second failure is believed: the caller draws its placeholder
 * rather than trying for ever.
 *
 * Returns the link to draw, the `onError` to hand the image, and whether it has
 * given up.
 */
export function useSignedUri(uri: string | null | undefined): {
  uri: string | null;
  onError: () => void;
  failed: boolean;
} {
  const [current, setCurrent] = useState<string | null>(uri ?? null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  // A new link from the screen — a reload, or a different photo — starts over.
  useEffect(() => {
    setCurrent(uri ?? null);
    setFailed(false);
    retried.current = false;
  }, [uri]);

  const onError = useCallback(() => {
    if (retried.current || !current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    const path = pathFromSignedUrl(current, HOUSEHOLD_FILES_BUCKET);
    if (!path) {
      setFailed(true);
      return;
    }
    refreshFileUrl(path)
      .then((next) => {
        if (!alive.current) return;
        if (next && next !== current) setCurrent(next);
        else setFailed(true);
      })
      .catch(() => {
        if (alive.current) setFailed(true);
      });
  }, [current]);

  return { uri: current, onError, failed };
}
