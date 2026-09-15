import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { thingHeadline, thingsInArea } from '@snag/supabase-queries';
import { Location, Snag, Thing } from '../types';

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
export type AmendStep = 'note' | 'room' | 'thing' | 'urgency';

/** Where to open: the words it hasn't got yet, or straight to where it is. */
export function firstStep(snag: Snag): AmendStep {
  return snag.description ? 'room' : 'note';
}

/**
 * Which steps this snag actually has, in order.
 *
 * **The "what is it about?" step exists only when there is something to point
 * at.** It comes after the room because the room is what narrows it: a house
 * holds tens of things and a snag is about one of them, so the offer is this
 * room's record and nothing else. A room with nothing recorded in it would give
 * a step with an empty rail and a Skip — a question the app cannot answer
 * asking the person to dismiss it — so the step is simply not there, and the
 * count in the header says three rather than four.
 *
 * That count moves if the room changes mid-sheet, which is correct: tagging the
 * Kitchen is what makes the kitchen's dishwasher offerable in the first place.
 */
export function amendSteps(snag: Snag, things: Thing[]): AmendStep[] {
  const offerable = thingsInArea(things, snag.room).length > 0;
  return offerable
    ? ['note', 'room', 'thing', 'urgency']
    : ['note', 'room', 'urgency'];
}

interface Props {
  snag: Snag;
  locations: Location[];
  /** The property's recorded things. Empty until they arrive, which is fine. */
  things?: Thing[];
  busy?: boolean;
  onSaveNote: (text: string) => Promise<void>;
  onSetRoom: (room: string | null) => Promise<void>;
  onSetThing: (thingId: string | null) => Promise<void>;
  onSetUrgent: (urgent: boolean) => Promise<void>;
  onOpenDetail: () => void;
  onClose: () => void;
}

export default function AmendSnagSheet({
  snag, locations, things = [], busy,
  onSaveNote, onSetRoom, onSetThing, onSetUrgent, onOpenDetail, onClose,
}: Props) {
  const [step, setStep] = useState<AmendStep>(() => firstStep(snag));
  const [note, setNote] = useState(snag.description ?? '');
  const keyboard = useKeyboardInset();

  const order = amendSteps(snag, things);
  const here = thingsInArea(things, snag.room);
  // The step can vanish under you — go back, clear the room, and there is
  // nothing to be about any more. Falling back to the room keeps the header
  // from reading "0 of 3".
  const index = Math.max(0, order.indexOf(step));
  const total = order.length;
  // `null` and `'low'` both already mean "not urgent" — only `high` is a
  // claim, so nothing has to be written for the default to be true.
  const urgent = snag.priority === 'high';

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
    if (step === 'room' || step === 'thing') {
      const at = order.indexOf(step);
      const following = order[at + 1];
      if (following) {
        setStep(following);
        return;
      }
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

        {/* ── 2. where is it ──────────────────────────────────────────── */}
        {step === 'room' ? (
          <>
            <Text style={styles.question}>Where is it?</Text>
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

        {/* ── 3. what is it about ─────────────────────────────────────
            Optional, like everything on this sheet, and offered only because
            the room has already been answered: these are the things recorded
            in *this* room, so the rail is three or four chips rather than a
            house's worth.

            The payoff is somewhere else entirely — in a shop, eight months
            later, wanting the model number. A snag that knows it is about the
            heat pump carries the heat pump's make and model with it; one that
            does not sends somebody back to the house record to search for it.

            **Pointing a snag at a thing does not start the job.** Assignee,
            due date, repeat and the parts list do; `thing_id` deliberately
            doesn't, because saying what something is about is the tail of
            capture — the same gesture as tagging the room — and a brand-new
            snag reading "Doing" because somebody named the appliance would
            empty the status from the same end the retired *Start it* button
            did. The `v_started` expression in `update_snag` says so. */}
        {step === 'thing' ? (
          <>
            <Text style={styles.question}>Is it about one of these?</Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.chips}>
                {here.map((item) => {
                  const on = snag.thingId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => onSetThing(on ? null : item.id)}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                        {thingHeadline(item)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </>
        ) : null}

        {/* ── 4. how urgent ───────────────────────────────────────────── */}
        {step === 'urgency' ? (
          <>
            <Text style={styles.question}>Does it need doing now?</Text>
            {/* Two named pills rather than one that toggles, because the
                answer is already on screen before anybody touches it: a lone
                "Urgent" chip left "not urgent" as the unlabelled absence of a
                press, which is a state nothing on the sheet said out loud. Not
                urgent is where every snag starts — nearly everything here can
                wait, and that is the premise of the list rather than a
                judgement it needs from you. */}
            <View style={styles.chips}>
              <Pressable
                onPress={() => urgent && onSetUrgent(false)}
                style={[styles.chip, !urgent && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: !urgent }}
              >
                <Text style={[styles.chipLabel, !urgent && styles.chipLabelOn]}>Not urgent</Text>
              </Pressable>
              <Pressable
                onPress={() => !urgent && onSetUrgent(true)}
                style={[styles.chip, urgent && styles.chipAlert]}
                accessibilityRole="button"
                accessibilityState={{ selected: urgent }}
              >
                <Text style={[styles.chipLabel, urgent && styles.chipAlertLabel]}>Urgent</Text>
              </Pressable>
            </View>
            {/* Its own line, not a third pill. The pills are one answer to one
                question; this is the door out of the sheet into triage, and a
                row mixing the two makes the answer look like three options. */}
            <Pressable onPress={onOpenDetail} style={styles.triage} accessibilityRole="button">
              <Text style={styles.triageLabel}>Sort it out…</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          onPress={next}
          disabled={busy}
          style={styles.next}
          accessibilityRole="button"
          accessibilityLabel={nextLabel(step, note, !!snag.thingId)}
        >
          {busy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.nextLabel}>{nextLabel(step, note, !!snag.thingId)}</Text>
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
 * was two controls with one outcome. The "what is it about" step reads the same
 * way until something is chosen.
 */
function nextLabel(step: AmendStep, note: string, linked: boolean): string {
  if (step === 'urgency') return 'Done';
  if (step === 'note' && note.trim() === '') return 'Skip for now';
  // Nothing has to be answered here either, and a Next over an untouched rail
  // is the app implying otherwise.
  if (step === 'thing' && !linked) return 'Skip for now';
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
  triage: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  triageLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
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
