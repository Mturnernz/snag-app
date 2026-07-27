import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import { InvestigationState, addWitnessStatement } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Sheet from './Sheet';

interface Props {
  issueId: string;
  state: InvestigationState;
  onChanged: () => void;
}

// Witness statements, with capture moved into a bottom sheet.
//
// Two fields (name, statement) used to sit inline alongside the evidence and
// root-cause forms, so a phone keyboard covered whichever you tapped and
// nothing marked where one record ended and the next began. In a sheet the
// statement field gets the height a statement actually needs, and Save means
// one unambiguous thing.
export default function WitnessesPanel({ issueId, state, onChanged }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  function close() {
    setOpen(false);
    setName('');
    setText('');
  }

  async function handleAdd() {
    if (!name.trim() || !text.trim()) {
      showToast('Add the witness name and their statement');
      return;
    }
    setSaving(true);
    const { error } = await addWitnessStatement(issueId, name.trim(), text.trim());
    setSaving(false);
    if (error) showToast(error.message ?? 'Could not add witness statement');
    else { close(); onChanged(); }
  }

  return (
    <View style={styles.wrap}>
      {state.witnesses.length === 0 ? (
        <Text style={styles.empty}>
          No statements yet. Record what someone who was there saw, in their words.
        </Text>
      ) : (
        state.witnesses.map((w) => (
          <View key={w.id} style={styles.item}>
            <Text style={styles.itemName}>{w.witness_name}</Text>
            <Text style={styles.itemBody}>{w.statement_text}</Text>
          </View>
        ))
      )}

      <Button label="Add a witness" variant="outline" onPress={() => setOpen(true)} fullWidth />

      <Sheet
        visible={open}
        title="Add a witness"
        subtitle="What they saw, in their own words — not your summary of it."
        submitLabel="Save statement"
        onSubmit={handleAdd}
        submitting={saving}
        submitDisabled={!name.trim() || !text.trim()}
        onClose={close}
      >
        <Text style={styles.label}>Who saw it?</Text>
        <TextInput
          style={styles.input}
          placeholder="Their name"
          placeholderTextColor={Colors.textMuted}
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Text style={styles.label}>What did they see?</Text>
        <TextInput
          style={[styles.input, styles.inputTall]}
          placeholder="e.g. Heard the reverse alarm, saw the forklift cross the yellow line while turning."
          placeholderTextColor={Colors.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          textAlignVertical="top"
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  empty: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  item: {
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.md,
    gap: 3,
  },
  itemName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  itemBody: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 20 },

  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  inputTall: { minHeight: 132, lineHeight: 21 },
});
