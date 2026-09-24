import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet } from 'react-native';
import Button from './Button';
import RoomPicker from './RoomPicker';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { Location, Snag } from '../types';

interface Props {
  visible: boolean;
  snag: Snag;
  locations: Location[];
  busy?: boolean;
  onSave: (update: { description: string | null; room: string | null }) => void;
  onCancel: () => void;
}

/**
 * Changing what a snag says, after it was filed.
 *
 * Capture asks nothing and the amend sheet asks straight after the shutter —
 * but both of those are gone by the time somebody re-reads "Gutters" a
 * fortnight later and wants it to say which gutters. Until now there was no way
 * back to either answer from the snag's own page: the room and the description
 * could only ever be set in the ten seconds after the photo.
 *
 * **These two are the only fields here, and that is the point.** Priority,
 * parts, assignee, due date and repeat all write on press in *Sort it out*,
 * because each is one small decision that is its own confirmation. The words
 * and the room are neither: they are typed and chosen together, they are the
 * *description* of the job rather than a decision about it, and a half-typed
 * sentence saving itself on every keystroke is not an edit — it is a race.
 * So one Save, like a thing's spec sheet.
 *
 * **Neither field starts the job.** `update_snag` moves a snag to 'doing' when
 * assignee, due date, repeat or parts change; room and description are
 * deliberately excluded, because they are the tail of capture and editing the
 * wording of something nobody has touched must not claim somebody has.
 *
 * The description cannot be emptied on a snag with no photograph
 * (`snags_has_something`), so the sheet says so rather than letting the
 * constraint name surface from Postgres.
 */
export default function EditSnagSheet({
  visible, snag, locations, busy = false, onSave, onCancel,
}: Props) {
  const keyboard = useKeyboardInset();
  const [words, setWords] = useState(snag.description ?? '');
  const [room, setRoom] = useState<string | null>(snag.room);

  // Seeded on open rather than on close, so a sheet reopened after a cancel
  // never arrives carrying the abandoned draft.
  useEffect(() => {
    if (visible) {
      setWords(snag.description ?? '');
      setRoom(snag.room);
    }
  }, [visible, snag.description, snag.room]);

  const trimmed = words.trim();
  const needsWords = snag.photoPaths.length === 0 && trimmed.length === 0;
  const unchanged = trimmed === (snag.description ?? '') && room === snag.room;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, keyboard > 0 && { marginBottom: keyboard }]}>
          <Text style={styles.title}>Edit this job</Text>

          <Text style={styles.fieldLabel}>What's wrong?</Text>
          <TextInput
            style={styles.input}
            value={words}
            onChangeText={setWords}
            placeholder="The cistern keeps running"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={200}
            accessibilityLabel="What's wrong?"
          />
          {needsWords ? (
            <Text style={styles.warn}>
              This one has no photo, so it needs a few words — otherwise there is nothing to go on.
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>Where is it?</Text>
          {/* Every room, never a shortlist — the one you want is the one you
              are standing in, and that is as likely to be the Roof as the
              Kitchen. It was a rail of chips, which makes that claim in a way
              that stops scaling the moment a household adds rooms to the
              seeded twelve. The picker searches instead, and it is the same
              control capture uses, so the two places a room is chosen cannot
              behave differently. */}
          <RoomPicker
            locations={locations}
            value={room}
            onChange={setRoom}
            disabled={busy}
            placeholder="Nowhere in particular"
          />

          <View style={styles.actions}>
            {/* **Done**, and never dead. It was *Save*, disabled until
                something changed — a button that looks like an obligation and
                then refuses the press. Every other surface on this page writes
                as it goes or on the way out; this one writes when it is closed
                with something changed, and simply closes otherwise. *Cancel*
                is still the way to walk away from an edit. */}
            <Button
              label="Done"
              onPress={() => (unchanged ? onCancel() : onSave({ description: trimmed || null, room }))}
              loading={busy}
              disabled={busy || needsWords}
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
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: Spacing.sm,
  },
  input: {
    minHeight: 72,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    padding: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  warn: { fontSize: Typography.xs, color: Colors.danger, lineHeight: 17 },
  actions: { gap: Spacing.xs, marginTop: Spacing.md },
});
