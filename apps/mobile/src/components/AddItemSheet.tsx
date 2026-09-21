import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface Props {
  visible: boolean;
  /** The part it will hang off, named so the sheet can say where it is going. */
  elementName: string | null;
  /** Whether the part layer is drawn — an implicit part has no name anybody chose. */
  showElement: boolean;
  onSave: (name: string, notes: string | null) => Promise<void>;
  onClose: () => void;
}

/**
 * One thing the job takes, added deliberately.
 *
 * It was a text box and a `+` sitting under the list, which is the compose
 * bar's gesture — right for a snag filed in ten seconds standing in front of
 * the problem, wrong here. An item on a renovation is named at a desk beside
 * a quote, and the inline box could only ever capture the **name**: the notes
 * `create_item` already accepts had nowhere to go, so anything worth
 * remembering about the item had to be added afterwards by opening it again.
 *
 * So the row becomes a pill and the pill opens this. **Only the name is
 * required**, which is the same rule the thing walkthrough follows: a field
 * somebody has to fill in before they can record what they are looking at is
 * how a record ends up empty.
 *
 * **The price is deliberately not here.** An item's price carries a lifecycle
 * — Quote or Invoiced, then accepted, declined or paid — and that lives on the
 * item's own sheet where the whole of it is visible. Asking for an amount at
 * the moment somebody is naming a thing would be a second place a price can be
 * entered, and two writers of one number is the failure this feature is built
 * against everywhere else.
 */
export default function AddItemSheet({ visible, elementName, showElement, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setNotes('');
  }, [visible]);

  const canSave = name.trim().length > 0;

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      await onSave(name.trim(), notes.trim() || null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title}>Add an item</Text>
          <Pressable
            onPress={onClose}
            style={styles.headTap}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {/* Where it is going, stated rather than asked: the pill that opened
              this was inside the part, which has already answered it. Absent
              while the layer is implicit, because there is no name anybody
              chose to say. */}
          {showElement && elementName ? (
            <Text style={styles.blurb}>Going on {elementName}.</Text>
          ) : null}

          <Text style={styles.label}>WHAT IS IT</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            accessibilityLabel="What the item is"
            autoFocus
          />

          <Text style={styles.label}>ANYTHING WORTH REMEMBERING</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            multiline
            accessibilityLabel="Notes about this item"
          />
          <Text style={styles.hint}>
            Optional. The price goes on the item itself, once there is one.
          </Text>
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel="Add it"
        >
          <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
            {busy ? 'Adding…' : 'Add it'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '90%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  grab: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
  title: {
    flex: 1, minWidth: 0,
    fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary,
  },
  headTap: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },
  blurb: { fontSize: Typography.sm, color: Colors.textSecondary },
  label: {
    fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.lg, marginBottom: Spacing.xs,
  },
  input: {
    fontSize: Typography.base, color: Colors.textPrimary,
    backgroundColor: Colors.sunken, borderRadius: Radius.input,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET, minWidth: 0,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
});
