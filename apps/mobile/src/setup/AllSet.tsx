import React, { useState } from 'react';

import SetupShell from './SetupShell';
import { takePhoto } from '../lib/photoUpload';
import { firstName } from './types';

interface Props {
  name: string | null | undefined;
  /** Into the app, holding the photograph to file if one was taken. */
  onFinish: (firstPhoto: string | null) => void;
}

/**
 * *You're all set* — and then the one thing the app is for.
 *
 * The phone ends on a welcome and a swipe; this ends on a camera, because the
 * first thing worth doing in Snag is photographing something that needs doing,
 * and the moment somebody has just finished setting up is the moment they are
 * most likely to have one in mind.
 *
 * **The camera opens from this press, not from the list.** A browser only
 * opens it from inside a tap, and by the time the list has mounted the tap is
 * over — so the photo is taken here and handed on, and the list files it
 * through the shutter's own path (`fileCapturedPhoto`), capture sheet and all.
 * A camera closed without a photo is simply the list.
 */
export default function AllSet({ name, onFinish }: Props) {
  const [busy, setBusy] = useState(false);
  const first = firstName(name);

  async function handleSnap() {
    setBusy(true);
    try {
      onFinish(await takePhoto());
    } catch (err) {
      console.error('The camera did not open:', err);
      onFinish(null);
    }
  }

  return (
    <SetupShell
      icon="checkmark-circle-outline"
      title={first ? `You're all set, ${first}` : "You're all set"}
      body="Snap the first thing that needs doing — it goes straight on the list."
      primary={{ label: 'Snap your first job', onPress: handleSnap, loading: busy }}
      secondary={{ label: 'Take me to the list', onPress: () => onFinish(null), disabled: busy }}
    />
  );
}
