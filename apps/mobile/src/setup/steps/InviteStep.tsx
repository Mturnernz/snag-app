import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import InviteLinkPanel from '../../components/InviteLinkPanel';
import { getHouseholdInvitations } from '../../lib/supabase';
import { Invitation } from '../../types';
import { SETUP_STEPS } from '../steps';
import type { StepProps } from '../types';

const CHANGE_LATER = SETUP_STEPS.find((step) => step.id === 'invite')?.changeLater;

/**
 * *Bring someone in* — the phone's "Add a family member", for whoever shares
 * the house.
 *
 * Offered only to somebody alone in the house (see `steps.ts`), and put off
 * with *Set up later*, because the other person may be asleep or across town
 * and a setup that insisted would be a setup people abandoned. It is the
 * Household screen's own panel: the link through the phone's share sheet, a
 * QR code for the same kitchen, and the live code reused rather than a second
 * one minted over it.
 *
 * **Nothing is sent, and nothing here says it was.** The share sheet is the
 * phone's and the words go wherever the person chooses.
 */
export default function InviteStep({ ctx, progress, onBack, onNext }: StepProps) {
  const [link, setLink] = useState<Invitation | null>(null);
  const household = ctx.household;

  useEffect(() => {
    if (!household) return;
    let live = true;
    getHouseholdInvitations(household.id)
      .then((all) => { if (live) setLink(all.find((i) => !!i.token) ?? null); })
      .catch((err) => console.error('Failed to read the invite link:', err));
    return () => { live = false; };
  }, [household]);

  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      icon="people-outline"
      title="Bring someone in"
      body="Share a link with whoever you share the house with. It's good for a day, and they choose whether to join."
      // Set up later until there is a link to show for it: two controls with
      // one outcome is a choice that isn't one.
      secondary={{ label: link ? 'Continue' : 'Set up later', onPress: onNext }}
    >
      {household ? (
        <InviteLinkPanel
          householdId={household.id}
          householdName={household.name}
          link={link}
          onLink={setLink}
        />
      ) : null}
      {CHANGE_LATER ? (
        <Text style={setupStyles.hint}>You can do this any time from {CHANGE_LATER}.</Text>
      ) : null}
    </SetupShell>
  );
}
