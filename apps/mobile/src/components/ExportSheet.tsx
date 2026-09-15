import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import Button from './Button';
import Icon from './Icon';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import type { ExportFormat } from '../lib/exportFile';

export type ExportScope = 'view' | 'all';

interface Props {
  visible: boolean;
  /** "the list" or "the house record" — what the sentence is about. */
  what: string;
  /** How many rows each scope would produce, so the choice is a fact not a guess. */
  counts: { view: number; all: number };
  busy?: boolean;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
  onCancel: () => void;
}

/**
 * One dialog for both halves of an extract: what goes in it, and what shape it
 * comes out as.
 *
 * **Scope is asked every time, and is not remembered.** A file whose contents
 * depend on a filter set twenty minutes ago is one you will misread later —
 * and the two answers are genuinely different documents, so a sticky default
 * would quietly make one of them the only one anybody ever gets. Both options
 * carry their row count, so the difference is visible before the tap rather
 * than discovered in a spreadsheet.
 *
 * Not `showAlert`: that takes two buttons at most (it is a `window.confirm` on
 * the web build) and this is a choice between four outcomes.
 *
 * The scope control is the app's one chip — a sunken well when off, solid fern
 * when on, no border either way — because a row of bordered white boxes on a
 * plaster ground reads as cards to read rather than controls to tap.
 */
export default function ExportSheet({
  visible, what, counts, busy = false, onExport, onCancel,
}: Props) {
  const [scope, setScope] = useState<ExportScope>('view');

  const rows = scope === 'view' ? counts.view : counts.all;

  const chip = (value: ExportScope, label: string, count: number) => {
    const on = scope === value;
    return (
      <Pressable
        onPress={() => setScope(value)}
        style={styles.chipTap}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${label}, ${count} ${count === 1 ? 'row' : 'rows'}`}
      >
        <View style={[styles.chip, on && styles.chipOn]}>
          <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
          <Text style={[styles.chipCount, on && styles.chipLabelOn]}>{count}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Take {what} out</Text>
          <Text style={styles.body}>
            A spreadsheet to sort and filter, or a PDF to send to somebody. Photos aren't in
            either — the file names what's there and how many.
          </Text>

          <View style={styles.chipRow}>
            {chip('view', "What's on screen", counts.view)}
            {chip('all', 'Everything', counts.all)}
          </View>

          <View style={styles.actions}>
            <Button
              label="Spreadsheet"
              variant="outline"
              icon="grid-outline"
              onPress={() => onExport(scope, 'csv')}
              disabled={busy || rows === 0}
              style={styles.action}
            />
            <Button
              label="PDF"
              icon="document-text-outline"
              onPress={() => onExport(scope, 'pdf')}
              loading={busy}
              disabled={busy || rows === 0}
              style={styles.action}
            />
          </View>

          {rows === 0 ? (
            <View style={styles.note}>
              <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.noteText}>There's nothing to put in it yet.</Text>
            </View>
          ) : null}

          <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} fullWidth />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.lg,
  },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  body: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 19,
    marginBottom: Spacing.xs,
  },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  // The tap area is the full 48; the pill inside it is smaller, so a row of
  // controls doesn't outweigh the dialog it sits in.
  chipTap: { flex: 1, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
  chipCount: { fontSize: Typography.sm, color: Colors.textMuted },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { flex: 1 },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted },
});
