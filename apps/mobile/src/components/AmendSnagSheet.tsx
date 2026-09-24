import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ActivityIndicator, StyleSheet,
} from 'react-native';

import Icon from './Icon';
import RoomPicker from './RoomPicker';
import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
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
 * **It asks two things, and it used to ask four.** What went is instructive.
 * *Is it about one of these?* offered the room's recorded appliances and wrote
 * `snags.thing_id`; the job's own page now shows what is in the room as a list
 * to read rather than a tag to apply. And *Does it need doing now?* is gone
 * with priority itself — nearly everything on a household list is filed as not
 * urgent, which is the premise of the product rather than a finding, so the
 * question spent a whole step of the one sheet that has ten seconds of patience
 * collecting the answer it already assumed.
 *
 * What is left is the two things that are **only** answerable here, with the
 * thing still in front of you, and unanswerable afterwards without opening the
 * job again:
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
 *   same thing, because at every point the snag is already complete enough —
 *   and finishing normally opens the job, which is where everything else about
 *   it is now decided.
 */
export type AmendStep = 'note' | 'room';

/** Where to open: the words it hasn't got yet, or straight to where it is. */
export function firstStep(snag: Snag): AmendStep {
  return snag.description ? 'room' : 'note';
}

/**
 * Which steps this snag has, in order.
 *
 * Both of them, always. It took a `Thing[]` and counted three or four depending
 * on whether the room had anything recorded in it — a header that moved
 * mid-sheet, which was correct then and is one less thing to be correct about
 * now. Kept as a function rather than inlined as a constant because the header
 * counts from it and the back button walks it.
 */
export function amendSteps(): AmendStep[] {
  return ['note', 'room'];
}

interface Props {
  snag: Snag;
  locations: Location[];
  busy?: boolean;
  onSaveNote: (text: string) => Promise<void>;
  onSetRoom: (room: string | null) => Promise<void>;
  /**
   * The room the last snag was filed in, when that was a few minutes ago.
   *
   * A walk round the house files things in batches — three in the bathroom,
   * then two in the laundry — and asking the same question five times over is
   * the one tap the batch does not need. It is offered, never written: the
   * snag gets it only when **Submit** is pressed with nothing else chosen.
   */
  suggestedRoom?: string | null;
  /**
   * Where the sheet goes when it is finished with.
   *
   * Finishing capture opens the job. Everything the sheet used to ask on steps
   * three and four is decided there now, and the alternative — dropping back
   * onto the list — meant the one moment somebody is certainly thinking about
   * this job ended by showing them every other one.
   */
  onOpenDetail: () => void;
  onClose: () => void;
}

export default function AmendSnagSheet({
  snag, locations, busy, onSaveNote, onSetRoom, suggestedRoom, onOpenDetail, onClose,
}: Props) {
  const [step, setStep] = useState<AmendStep>(() => firstStep(snag));
  /**
   * The suggestion still standing. Cleared the moment somebody touches the
   * picker, so a room they deliberately un-chose is not quietly put back.
   */
  const [suggestion, setSuggestion] = useState<string | null>(
    () => (snag.room ? null : suggestedRoom ?? null)
  );
  const [note, setNote] = useState(snag.description ?? '');
  const keyboard = useKeyboardInset();
  const edge = useEdgeInsets();

  const order = amendSteps();
  const index = Math.max(0, order.indexOf(step));
  const total = order.length;

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
    // The last step. Dismissing is finishing, and finishing opens the job.
    if (suggestion && !snag.room) await onSetRoom(suggestion);
    onOpenDetail();
  }

  /**
   * **Choosing a room is the answer, so it finishes the sheet.** It used to
   * write the room and then wait for Submit — a second tap confirming a choice
   * that was its own confirmation. Pressing the chosen room again still clears
   * it, and that does not finish anything: somebody taking a room away is
   * about to pick another, or to Submit with none.
   */
  async function chooseRoom(picked: string | null) {
    // The picker reports a press on the lit row as "clear it". A suggested row
    // is lit without being chosen, so pressing it is taking the suggestion.
    const room = picked === null && suggestion && !snag.room ? suggestion : picked;
    setSuggestion(null);
    await onSetRoom(room);
    if (room) onOpenDetail();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      {/* The home indicator's height under the Submit button. Without it the
          one button this sheet exists for sat on the iPhone's bottom edge. */}
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : edge.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />

        <View style={styles.head}>
          {index > 0 ? (
            <Pressable
              onPress={() => setStep(order[index - 1])}
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

        {/* ── 2. where is it ──
            Every room is offered, never a shortlist: the one you want is the
            one you are standing in, and that is as likely to be the Roof as
            the Kitchen. It was a rail of every room as a chip, which is the
            same claim made in a way that stops scaling the moment a household
            adds a conservatory and a storage area to the seeded twelve — and
            a wall of grey has to be read before it can be tapped. The picker
            searches instead. See RoomPicker. */}
        {step === 'room' ? (
          <>
            <Text style={styles.question}>Where is it?</Text>
            <RoomPicker
              locations={locations}
              value={snag.room ?? suggestion}
              onChange={(room) => { void chooseRoom(room); }}
              disabled={busy}
              startOpen
            />
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
 *
 * The last step's button says **Submit**. Not "Done", which would describe the
 * sheet's own dismissal while it is actually navigating somewhere, and not
 * "Sort it out", which named the destination rather than the act — somebody
 * answering two questions about a thing they have just photographed is
 * finishing filing it, and that is the word for it.
 *
 * Note the snag itself was already created before this sheet opened, which is
 * the arrangement's whole point: nothing here can block anybody. So Submit ends
 * capture rather than performing it.
 */
function nextLabel(step: AmendStep, note: string): string {
  if (step === 'room') return 'Submit';
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
  note: {
    minHeight: 96,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.button,
    padding: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
  },
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
