import React, { useState } from 'react';

import SetupShell from '../SetupShell';
import TourCards, { tourCards } from '../../components/TourCards';
import type { StepProps } from '../types';

/**
 * *How Snag works*: three cards, swiped or paged with the buttons.
 *
 * It asks nothing. Each card's *Try it* ends setup and opens that thing in the
 * app — the rooms, the walkthrough, the capture sheet — because a tour that
 * describes adding an appliance is worth less than the walkthrough itself,
 * one tap away. *Skip* and *Done* both move on, and it is never shown again
 * (`setup_seen`); the You tab keeps it under *How Snag works*.
 */
export default function TourStep({ progress, onBack, onNext, onTry }: StepProps) {
  const [index, setIndex] = useState(0);
  const last = index === tourCards().length - 1;

  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      title="How Snag works"
      primary={{ label: last ? 'Done' : 'Next', onPress: last ? onNext : () => setIndex(index + 1) }}
      secondary={last ? undefined : { label: 'Skip', onPress: onNext }}
    >
      <TourCards index={index} onIndex={setIndex} onTry={onTry} />
    </SetupShell>
  );
}
