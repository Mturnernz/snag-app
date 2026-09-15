import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import Button from './Button';
import Icon from './Icon';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { EXPORT_PHOTO_LIMIT } from '@snag/supabase-queries';
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
 * comes out as — then **one button that does it**.
 *
 * **Both questions are answered before anything happens.** Spreadsheet and PDF
 * used to *be* the action: two buttons, each of which chose a format and fired
 * at the same time. That put the only irreversible control on the sheet one tap
 * from opening it, and it made the sheet contradict itself — the scope rail
 * said "pick one of these" while the row underneath said "press either of these
 * to finish". Worse, the chosen scope chip and the PDF button were both solid
 * fern, so three of the five controls looked like the primary action and none of
 * them was labelled as one. Now every control above the fold is a choice, the
 * one thing that leaves the app says **Export**, and it is the only filled
 * button in the dialog.
 *
 * **Scope is asked every time, and is not remembered.** A file whose contents
 * depend on a filter set twenty minutes ago is one you will misread later —
 * and the two answers are genuinely different documents, so a sticky default
 * would quietly make one of them the only one anybody ever gets. Both options
 * carry their row count, so the difference is visible before the tap rather
 * than discovered in a spreadsheet.
 *
 * Not `showAlert`: that takes two buttons at most (it is a `window.confirm` on
 * the web build) and this is two questions and a confirmation.
 *
 * Every chip here is the app's one chip — a sunken well when off, solid fern
 * when on, no border either way — because a row of bordered white boxes on a
 * plaster ground reads as cards to read rather than controls to tap. That rule
 * is why the old outlined *Spreadsheet* button never sat right beside the
 * filled *PDF* one: two controls doing the identical job, drawn as two
 * different kinds of thing.
 */
export default function ExportSheet({
  visible, what, counts, busy = false, onExport, onCancel,
}: Props) {
  const [scope, setScope] = useState<ExportScope>('view');
  const [format, setFormat] = useState<ExportFormat>('csv');

  const rows = scope === 'view' ? counts.view : counts.all;

  const chip = (
    on: boolean,
    label: string,
    onPress: () => void,
    extras: { count?: number; icon?: 'grid-outline' | 'document-text-outline' } = {},
  ) => (
    <Pressable
      onPress={onPress}
      style={styles.chipTap}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={
        extras.count === undefined
          ? label
          : `${label}, ${extras.count} ${extras.count === 1 ? 'row' : 'rows'}`
      }
    >
      <View style={[styles.chip, on && styles.chipOn]}>
        {extras.icon ? (
          <Icon name={extras.icon} size="sm" color={on ? Colors.white : Colors.textSecondary} />
        ) : null}
        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
        {extras.count === undefined ? null : (
          <Text style={[styles.chipCount, on && styles.chipLabelOn]}>{extras.count}</Text>
        )}
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Take {what} out</Text>
          <Text style={styles.body}>
            A spreadsheet to sort and filter, or a PDF to send to somebody.
          </Text>

          <Text style={styles.fieldLabel}>What goes in</Text>
          <View style={styles.chipRow}>
            {chip(scope === 'view', "What's on screen", () => setScope('view'), { count: counts.view })}
            {chip(scope === 'all', 'Everything', () => setScope('all'), { count: counts.all })}
          </View>

          <Text style={styles.fieldLabel}>What shape</Text>
          <View style={styles.chipRow}>
            {chip(format === 'csv', 'Spreadsheet', () => setFormat('csv'), { icon: 'grid-outline' })}
            {chip(format === 'pdf', 'PDF', () => setFormat('pdf'), { icon: 'document-text-outline' })}
          </View>
          {/* Said here rather than in the blurb, because it is the one real
              difference between the two files and it is the reason somebody
              picks the PDF. A spreadsheet cell cannot hold a picture, so the
              CSV keeps the count it always had. */}
          <Text style={styles.hint}>
            {format === 'pdf'
              ? `The photos go in too, up to ${EXPORT_PHOTO_LIMIT} of them.`
              : 'No photos in a spreadsheet — just how many each row has.'}
          </Text>

          {rows === 0 ? (
            <View style={styles.note}>
              <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.noteText}>There's nothing to put in it yet.</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label="Export"
              icon="download-outline"
              onPress={() => onExport(scope, format)}
              loading={busy}
              disabled={busy || rows === 0}
              fullWidth
            />
            <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} fullWidth />
          </View>
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
    gap: Spacing.xs,
    ...Shadow.lg,
  },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  body: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 19,
    marginBottom: Spacing.xs,
  },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: Spacing.xs,
  },
  hint: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: Spacing.xs },
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
  actions: { marginTop: Spacing.md, gap: Spacing.xs },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted },
});
