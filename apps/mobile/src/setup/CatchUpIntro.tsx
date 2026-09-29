import React from 'react';

import SetupShell from './SetupShell';
import { Group, Row } from '../components/Grouped';
import type { SetupStep } from './steps';

interface Props {
  steps: SetupStep[];
  onContinue: () => void;
}

/**
 * What a phone shows after an update: the new screens, named, before them.
 *
 * Somebody who has been using Snag for months is not being set up — they are
 * being asked one or two things that did not exist when they were. So the run
 * opens by saying what those are, in each step's own `whatsNew` line, and ends
 * straight back in the app rather than on *You're all set*.
 */
export default function CatchUpIntro({ steps, onContinue }: Props) {
  return (
    <SetupShell
      icon="gift-outline"
      title={steps.length === 1 ? 'One new thing' : 'A few new things'}
      body="Snag has grown since you set it up. This only takes a moment."
      primary={{ label: 'Continue', onPress: onContinue }}
    >
      <Group>
        {steps.map((step) => (
          <Row key={step.id} title={step.whatsNew ?? step.id} />
        ))}
      </Group>
    </SetupShell>
  );
}
