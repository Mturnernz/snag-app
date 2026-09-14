import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { Location, Snag } from '../types';

/**
 * What is asked straight after a snag is filed.
 *
 * **The snag already exists when this opens, and that is the whole rule.** It
 * asks after the save and never before it: every control here edits a row that
 * is already on the list, so nothing in it can block anybody, and walking away
 * without touching one leaves a perfectly good entry. A sheet that stood
 * between the shutter and the save would be the old Add tab with a new shape.
 *
 * It replaced a row of chips above the compose bar. That row was right about
 * what to ask and wrong about how: the note was typed into the compose bar,
 * whose field quietly changed meaning after a photo, and nobody noticed. People
 * filed a photo and then opened the snag again to describe it — which is the
 * one journey the arrangement existed to remove.
 *
 * Three things about it:
 *
 * - **Notes first, when there are none.** A photo with no words and no room is
 *   the weakest thing this app can hold: `snagHeadline` has nothing to work with
 *   and the list reads "Something to sort out", which is unreadable a fortnight
 *   later to the person who filed it. A snag that arrived as typed words is its
 *   own description, so for that one this opens on the room instead.
 * - **Every step writes as you leave it.** Unlike the house walkthrough, which
 *   defers everything to its last step because nothing exists yet. Here the row
 *   exists, so deferring would reintroduce exactly the loss this replaced.
 * - **Dismissing is finishing.** The backdrop, the ×, and Done all mean the
 *   same thing, because at every point the snag is already complete enough.
 */
export type AmendStep = 'note' | 'room' | 'urgency';

/** Where to open: the words it hasn't got yet, or straight to where it is. */
export function firstStep(snag: Snag): AmendStep {
  return snag.description ? 'room' : 'note';
}

interface Props {
  snag: Snag;
  locations: Location[];
  busy?: boolean;
  onSaveNote: (text: string) => Promise<void>;
  onSetRoom: (room: string | null) => Promise<void>;
  onSetUrgent: (urgent: boolean) => Promise<void>;
  onOpenDetail: () => void;
  onClose: () => void;
}

const ORDER: AmendStep[] = ['note', 'room', 'urgency'];

export default function AmendSnagSheet({
  snag, locations, busy, onSaveNote, onSetRoom, onSetUrgent, onOpenDetail, onClose,
}: Props) {
  const [step, setStep] = useState<AmendStep>(() => firstStep(snag));
  const [note, setNote] = useState(snag.description ?? '');
  const keyboard = useKeyboardInset();

  const index = ORDER.indexOf(step);
  const total = ORDER.length;

  async function next() {
    if (step === 'note') {
      const text = note.trim();
      // Only write if there is something to write. An empty note on a snag that
      // never had one is not a change, and saving it would touch updated_at for
      // nothing.
      if (text && text !== (snag.description ?? '')) await onSaveNote(text);
      setStep('room');
      return;
    }
    if (step === 'room') {
      setStep('urgency');
      return;
    }
    onClose();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { marginBottom: keyboard }]}>
        <View style={styles.grab} />

        <View style={styles.head}>
          {index > 0 ? (
            <Pressable
              onPress={() => setStep(ORDER[index - 1])}
              style={styles.headTap}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon name="chevron-back" size="md" color={Colors.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.headTap} />
          )}
          <Text style={styles.stepLabel}>{`On the list · ${index + 1} of ${total}`}</Text>
          <Pressable
            onPress={onClose}
            style={styles.headTap}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Icon name="close" size="md" color={Colors.textSecondary} />
          </Pressable>
        </View>

        {/* ── 1. what is it ───────────────────────────────────────────── */}
        {step === 'note' ? (
          <>
            <Text style={styles.question}>What's wrong?</Text>
            <Text style={styles.hint}>
              A few words is plenty. It is what the list shows, and what makes this findable in a
              fortnight.
            </Text>
            <TextInput
              style={styles.note}
              value={note}
              onChangeText={setNote}
              placeholder="Toilet seat hinge has sheared off"
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus
              maxLength={1000}
              accessibilityLabel="What's wrong"
            />
          </>
        ) : null}

        {/* ── 2. where is it ──────────────────────────────────────────── */}
        {step === 'room' ? (
          <>
            <Text style={styles.question}>Where is it?</Text>
            <Text style={styles.hint}>
              The list groups by room, so this is what puts it beside the other things waiting in
              the same place.
            </Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.chips}>
                {locations.map((location) => {
                  const on = snag.room === location.name;
                  return (
                    <Pressable
                      key={location.id}
                      onPress={() => onSetRoom(on ? null : location.name)}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                        {location.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </>
        ) : null}

        {/* ── 3. how urgent ───────────────────────────────────────────── */}
        {step === 'urgency' ? (
          <>
            <Text style={styles.question}>Does it need doing now?</Text>
            <Text style={styles.hint}>
              Nearly everything here can wait, which is the point of the list. Urgent is for the
              things that can't.
            </Text>
            <View style={styles.chips}>
              <Pressable
                onPress={() => onSetUrgent(snag.priority !== 'high')}
                style={[styles.chip, snag.priority === 'high' && styles.chipAlert]}
                accessibilityRole="button"
                accessibilityState={{ selected: snag.priority === 'high' }}
              >
                <Text
                  style={[styles.chipLabel, snag.priority === 'high' && styles.chipAlertLabel]}
                >
                  Urgent
                </Text>
              </Pressable>
              <Pressable
                onPress={onOpenDetail}
                style={styles.chip}
                accessibilityRole="button"
              >
                <Text style={styles.chipLabel}>Sort it out…</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Pressable
          onPress={next}
          disabled={busy}
          style={styles.next}
          accessibilityRole="button"
          accessibilityLabel={nextLabel(step, note)}
        >
          {busy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.nextLabel}>{nextLabel(step, note)}</Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * The button says what pressing it does.
 *
 * On the note step with nothing typed that is "Skip for now", not "Next" — the
 * same call `AddThingSheet` makes, and for the same reason: a Next beside a Skip
 * was two controls with one outcome.
 */
function nextLabel(step: AmendStep, note: string): string {
  if (step === 'urgency') return 'Done';
  if (step === 'note' && note.trim() === '') return 'Skip for now';
  return 'Next';
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 39, 36, 0.4)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    ...Shadow.lg,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  question: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  note: {
    minHeight: 96,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.button,
    padding: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
  },
  scroll: { maxHeight: 240 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipAlert: { backgroundColor: Colors.danger },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  chipAlertLabel: { color: Colors.white, fontWeight: Typography.semibold },
  next: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  nextLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.white },
});
