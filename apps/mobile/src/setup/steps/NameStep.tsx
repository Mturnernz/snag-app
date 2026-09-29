import React, { useEffect, useState } from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import { Colors, Typography } from '../../constants/theme';
import { getMyInvitations, upsertProfile } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import type { StepProps } from '../types';

/**
 * *What should we call you?* — the one thing every person is asked.
 *
 * A name first, because every list in the house shows it and a member with no
 * name is a blank row; `accept_invitation` refuses one for that reason. When
 * Google already knows it, it is offered in the box rather than asked from
 * nothing — the phone's own "Is this you?" — and the box is still the box, so
 * a nickname is one edit away.
 */
export default function NameStep({ ctx, progress, onBack, onNext, onReady, suggestedName }: StepProps) {
  const [name, setName] = useState(ctx.profile?.displayName ?? suggestedName ?? '');
  const [saving, setSaving] = useState(false);
  const [invitedTo, setInvitedTo] = useState<{ house: string; by: string } | null>(null);
  const [missing, setMissing] = useState(false);

  // Somebody invited by address should be told so on the very first question,
  // not two screens later: that gap is where an invitee meets *Start a new
  // house* and makes a second household of their own — the Alyssa bug by the
  // invitation's door. The answer itself is on the next step, which needs the
  // name this one asks for. `my_invitations` matches on the signed-in address,
  // so it can be asked before there is a profile. Never fatal.
  useEffect(() => {
    let live = true;
    getMyInvitations()
      .then((all) => {
        const first = all[0];
        if (live && first) setInvitedTo({ house: first.householdName, by: first.invitedByName });
      })
      .catch((err) => console.error('Failed to check for invitations:', err));
    return () => { live = false; };
  }, []);

  async function handleContinue() {
    const next = name.trim();
    // Never a dead button: a press with nothing typed says what is wanted.
    if (!next) {
      setMissing(true);
      return;
    }
    // An unchanged name is nothing to write: going back to look is not an edit.
    if (next === ctx.profile?.displayName) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      await upsertProfile(next);
      await onReady();
      onNext();
    } catch (err: any) {
      showAlert("Couldn't save your name", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      icon={invitedTo ? 'home-outline' : 'happy-outline'}
      title="What should we call you?"
      body={invitedTo
        ? `${invitedTo.by} has invited you to ${invitedTo.house}. First, the name they'll see.`
        : "It's the name the others in your house will see."}
      primary={{
        label: 'Continue',
        onPress: handleContinue,
        loading: saving,
      }}
    >
      <TextInput
        style={setupStyles.input}
        value={name}
        onChangeText={(next) => {
          setName(next);
          if (missing) setMissing(false);
        }}
        placeholderTextColor={Colors.textMuted}
        maxLength={80}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        returnKeyType="next"
        onSubmitEditing={handleContinue}
        accessibilityLabel="Your name"
        autoFocus={!name}
      />
      {missing ? (
        <Text style={styles.missing} accessibilityRole="alert">
          Tell us what to call you.
        </Text>
      ) : null}
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  missing: { fontSize: Typography.sm, color: Colors.danger },
});
