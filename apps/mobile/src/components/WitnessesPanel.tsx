import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';

import { WitnessStatement } from '../types';
import { InvestigationState, addWitnessStatement, getEvidencePhotoUrl } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import DocumentAttach from './DocumentAttach';
import Icon from './Icon';
import Sheet from './Sheet';

interface Props {
  issueId: string;
  /** snag-evidence is org-folder scoped — an attached statement document is
   *  copied in there, same as evidence. */
  orgId: string;
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
export default function WitnessesPanel({ issueId, orgId, state, onChanged }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // The signed sheet or scan the statement was taken from. Alongside the typed
  // text, never instead of it: a statement nobody can read without downloading
  // an attachment is not a searchable record of what the witness said.
  const [document, setDocument] = useState<{ path: string; label: string } | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);

  function close() {
    setOpen(false);
    setName('');
    setText('');
    setDocument(null);
  }

  async function handleAdd() {
    if (!name.trim() || !text.trim()) {
      showToast('Add the witness name and their statement');
      return;
    }
    // try/finally, not a bare await: a save that throws used to leave the
    // button spinning with nothing said, which is indistinguishable from one
    // still in flight. Whatever happens, the spinner stops and the user is
    // told something.
    setSaving(true);
    try {
      const { error } = await addWitnessStatement(issueId, name.trim(), text.trim(), document?.path ?? null);
      if (error) showToast(error.message ?? 'Could not add witness statement');
      else { close(); onChanged(); }
    } catch (err: any) {
      showToast(err?.message ?? 'Could not add witness statement');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {state.witnesses.length === 0 ? (
        <Text style={styles.empty}>
          No statements yet. Record what someone who was there saw, in their words.
        </Text>
      ) : (
        state.witnesses.map((w) => <WitnessRow key={w.id} item={w} />)
      )}

      <Button label="Add a witness" variant="outline" onPress={() => setOpen(true)} fullWidth />

      <Sheet
        visible={open}
        title="Add a witness"
        subtitle="What they saw, in their own words — not your summary of it."
        submitLabel="Save statement"
        onSubmit={handleAdd}
        submitting={saving}
        submitDisabled={!name.trim() || !text.trim() || documentBusy}
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

        <Text style={styles.label}>Signed statement or scan (optional)</Text>
        <DocumentAttach
          orgId={orgId}
          value={document}
          onChange={setDocument}
          onBusyChange={setDocumentBusy}
        />
      </Sheet>
    </View>
  );
}

function WitnessRow({ item }: { item: WitnessStatement }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (item.media_path) getEvidencePhotoUrl(item.media_path).then(setUrl);
  }, [item.media_path]);

  return (
    <View style={styles.item}>
      <Text style={styles.itemName}>{item.witness_name}</Text>
      <Text style={styles.itemBody}>{item.statement_text}</Text>
      {url && (
        <TouchableOpacity style={styles.attachment} onPress={() => Linking.openURL(url)} activeOpacity={0.7}>
          <Icon name="document-text-outline" size="sm" color={Colors.primary} />
          <Text style={styles.attachmentText} numberOfLines={1}>
            {item.media_path?.split('/').pop() ?? 'Statement document'}
          </Text>
          <Icon name="open-outline" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      )}
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
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  attachmentText: { flex: 1, fontSize: Typography.sm, color: Colors.primary },

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
