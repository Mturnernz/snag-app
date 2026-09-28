import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import RoomsEditor from '../../components/RoomsEditor';
import { getMyProperties } from '../../lib/supabase';
import { SETUP_STEPS } from '../steps';
import type { StepProps } from '../types';

const CHANGE_LATER = SETUP_STEPS.find((step) => step.id === 'rooms')?.changeLater;

/**
 * *Here are your rooms* — the twelve seeded tags, shown once so the house can
 * be made to match.
 *
 * Every room is offered at capture and the list groups by them, so a house
 * with no Garage and a Sleepout the seed never guessed at is worth sorting out
 * once, now, rather than discovered the first time a photo is filed. It is the
 * same editor as Location tags, so the two cannot disagree about what adding
 * or removing a room does, and everything written here is written on the press.
 *
 * The second person in a house sees it too: they may know about the
 * conservatory the first one forgot. For them a removal still asks, because
 * the rooms are the other person's too.
 */
export default function RoomsStep({ ctx, progress, onBack, onNext }: StepProps) {
  const [propertyId, setPropertyId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyProperties()
      .then((places) => {
        const mine = places.filter((p) => p.householdId === ctx.household?.id);
        if (live) setPropertyId((mine[0] ?? places[0])?.id ?? null);
      })
      .catch((err) => console.error('Failed to load the place:', err));
    return () => { live = false; };
  }, [ctx.household?.id]);

  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      icon="grid-outline"
      title="Here are your rooms"
      body="Here are your first rooms — you can add more when you're ready."
      primary={{ label: 'Continue', onPress: onNext }}
    >
      <RoomsEditor
        propertyId={propertyId}
        confirmRemoval={ctx.memberCount > 1}
        addLabel="Add a room"
      />
      {CHANGE_LATER ? (
        <Text style={setupStyles.hint}>You can change these any time from {CHANGE_LATER}.</Text>
      ) : null}
    </SetupShell>
  );
}
