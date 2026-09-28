import React, { useState } from 'react';
import { TextInput } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import { Colors } from '../../constants/theme';
import { upsertProfile } from '../../lib/supabase';
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

  async function handleContinue() {
    const next = name.trim();
    if (!next) return;
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
      icon="happy-outline"
      title="What should we call you?"
      body="It's the name the others in your house will see."
      primary={{
        label: 'Continue',
        onPress: handleContinue,
        disabled: !name.trim(),
        loading: saving,
      }}
    >
      <TextInput
        style={setupStyles.input}
        value={name}
        onChangeText={setName}
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
    </SetupShell>
  );
}
