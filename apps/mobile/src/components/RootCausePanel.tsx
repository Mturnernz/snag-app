import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import { InvestigationState, setRootCause } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';

interface Props {
  issueId: string;
  state: InvestigationState;
  onChanged: () => void;
}

// Root cause, in a card of its own.
//
// Deliberately still inline rather than behind a sheet, unlike witnesses and
// evidence. It's a single field with no siblings once the old combined drawer
// is split, which is exactly the case where a sheet costs a tap and buys
// nothing — and this is the field you least want to add friction to.
export default function RootCausePanel({ issueId, state, onChanged }: Props) {
  const { showToast } = useToast();
  const [text, setText] = useState(state.rootCause ?? '');
  const [saving, setSaving] = useState(false);

  // Keep in sync if the parent refetches with a value recorded elsewhere.
  useEffect(() => { setText(state.rootCause ?? ''); }, [state.rootCause]);

  const recorded = Boolean(state.rootCause && state.rootCause.trim());
  const dirty = text.trim() !== (state.rootCause ?? '').trim();

  async function handleSave() {
    if (!text.trim()) {
      showToast('Enter the root cause');
      return;
    }
    setSaving(true);
    try {
      const { error } = await setRootCause(issueId, text.trim());
      if (error) showToast(error.message ?? 'Could not save root cause');
      else { showToast('Root cause recorded'); onChanged(); }
    } catch (err: any) {
      showToast(err?.message ?? 'Could not save root cause');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        What actually caused this — not what went wrong, but why it could.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. No physical separation between forklift routes and the pedestrian walkway"
        placeholderTextColor={Colors.textMuted}
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
      />
      <Button
        label={recorded ? 'Update root cause' : 'Save root cause'}
        variant="outline"
        onPress={handleSave}
        loading={saving}
        disabled={!dirty}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  input: {
    minHeight: 96,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
});
