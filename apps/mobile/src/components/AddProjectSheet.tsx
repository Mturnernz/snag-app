import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { parseLooseDate, formatLooseDate, type ProjectInput } from '@snag/supabase-queries';
import { Location, ProjectStatus, PROJECT_STATUS_LABELS } from '../types';

type Step = 'name' | 'rooms' | 'when';
const STEPS: Step[] = ['name', 'rooms', 'when'];

interface Props {
  visible: boolean;
  propertyId: string;
  locations: Location[];
  onCancel: () => void;
  onCreate: (input: ProjectInput) => Promise<void>;
}

/**
 * Starting a project, in three questions, of which only the first is required.
 *
 * The same bargain `AddThingSheet` makes and for the same reason: every
 * house-inventory product ever shipped opens on an empty thirty-field form, and
 * the record ends up 8% complete — which is worse than none, because you check
 * it once, find nothing, and never check again. A project with a name and
 * nothing else is a perfectly good row.
 *
 * Three things here are load-bearing.
 *
 * **Elements come from step two, not from a concept anybody has to learn.**
 * "Which rooms does it touch" produces one element per room, already named, and
 * the sheet says so in one line under the chips. Pick one room and elements
 * never appear at all — the middle layer has not earned its place, so the server
 * makes it implicit and the client never draws it. Nobody is ever asked to
 * understand the hierarchy before they can record a renovation.
 *
 * **"Already finished" is a first-class answer**, not an edge case. Recording
 * the bathroom you did in 2024 is how the record becomes useful before the next
 * renovation starts, and it is where the receipts and the guarantee live. The
 * status chips decide which date the last step asks for, so somebody answering
 * *Already finished* is asked when it finished rather than when it starts.
 *
 * **The budget carries the GST pill like every other amount.** There is no
 * household-wide GST setting anywhere in this app, deliberately — see
 * `MoneyField`.
 *
 * Nothing is written until the last step, which is forced rather than chosen:
 * `create_project` needs a name and the rooms in one call, because it creates
 * the elements in the same transaction. A project half-created by somebody who
 * walked away mid-flow would be a row with no parts to hang anything off.
 */
export default function AddProjectSheet({
  visible, propertyId, locations, onCancel, onCreate,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [rooms, setRooms] = useState<string[]>([]);
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const [startedOn, setStartedOn] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [finishedOn, setFinishedOn] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetIncl, setBudgetIncl] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('name');
    setName('');
    setRooms([]);
    setStatus('planned');
    setStartedOn('');
    setTargetOn('');
    setFinishedOn('');
    setBudget('');
    setBudgetIncl(true);
    setBusy(false);
  }, [visible]);

  const index = STEPS.indexOf(step);

  function back() {
    if (index === 0) {
      onCancel();
      return;
    }
    setStep(STEPS[index - 1]);
  }

  function toggleRoom(room: string) {
    setRooms((current) =>
      current.includes(room) ? current.filter((r) => r !== room) : [...current, room]
    );
  }

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        propertyId,
        name: name.trim(),
        status,
        rooms,
        startedOn: parseLooseDate(startedOn) ?? null,
        targetOn: parseLooseDate(targetOn) ?? null,
        finishedOn: parseLooseDate(finishedOn) ?? null,
        budget: budget.trim() ? Number(budget.replace(/[^0-9.]/g, '')) || null : null,
        budgetInclGst: budgetIncl,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />

        <View style={styles.head}>
          <Pressable onPress={back} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron-back" size="md" color={Colors.textMuted} />
          </Pressable>
          <Text style={styles.step}>
            Step {index + 1} of 3{step === 'name' ? ' · required' : ''}
          </Text>
          <Pressable onPress={onCancel} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Cancel">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        {/* ── 1. what are you doing ───────────────────────────────────── */}
        {step === 'name' ? (
          <View>
            <Text style={styles.question}>What are you doing?</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Downstairs laundry"
              placeholderTextColor={Colors.textMuted}
              autoFocus
              accessibilityLabel="What are you doing?"
            />
            <Text style={styles.hint}>The name you’d say out loud.</Text>
          </View>
        ) : null}

        {/* ── 2. which rooms — and where elements come from ───────────── */}
        {step === 'rooms' ? (
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.question}>Which rooms does it touch?</Text>
            <View style={styles.chips}>
              {locations.map((location) => {
                const on = rooms.includes(location.name);
                return (
                  <Pressable
                    key={location.id}
                    onPress={() => toggleRoom(location.name)}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={location.name}
                  >
                    <View style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                        {location.name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {/* Said in one line, at the moment the answer decides it, rather
                than as a concept explained anywhere. */}
            <Text style={styles.hint}>
              {rooms.length >= 2
                ? `Each room becomes a part of the job you can price on its own — ${rooms.length} of them.`
                : 'Each room you pick becomes a part of the job you can price separately. Pick one and you won’t see parts at all.'}
            </Text>
          </ScrollView>
        ) : null}

        {/* ── 3. where's it up to ─────────────────────────────────────── */}
        {step === 'when' ? (
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.question}>Where’s it up to?</Text>
            <View style={styles.chips}>
              {(['planned', 'underway', 'done'] as ProjectStatus[]).map((option) => {
                const on = status === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setStatus(option)}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={option === 'done' ? 'Already finished' : PROJECT_STATUS_LABELS[option]}
                  >
                    <View style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                        {option === 'done' ? 'Already finished' : PROJECT_STATUS_LABELS[option]}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {status !== 'planned' ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Started</Text>
                <TextInput
                  style={styles.input}
                  value={startedOn}
                  onChangeText={setStartedOn}
                  placeholder="4 August 2026"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel="Started"
                />
              </View>
            ) : null}

            {status === 'done' ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Finished</Text>
                <TextInput
                  style={styles.input}
                  value={finishedOn}
                  onChangeText={setFinishedOn}
                  placeholder="March 2026"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel="Finished"
                />
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Hoping to finish</Text>
                <TextInput
                  style={styles.input}
                  value={targetOn}
                  onChangeText={setTargetOn}
                  placeholder="No date — that’s fine"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel="Hoping to finish"
                />
              </View>
            )}

            <MoneyField
              label="Budget, if there is one"
              value={budget}
              onChangeValue={setBudget}
              inclusive={budgetIncl}
              onChangeInclusive={setBudgetIncl}
            />
          </ScrollView>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            onPress={() => (step === 'when' ? save() : setStep(STEPS[index + 1]))}
            disabled={busy || (step === 'name' && !name.trim())}
            style={[styles.cta, (busy || (step === 'name' && !name.trim())) && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel={step === 'when' ? 'Start it' : 'Next'}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text
                style={[
                  styles.ctaLabel,
                  step === 'name' && !name.trim() && styles.ctaLabelOff,
                ]}
              >
                {step === 'when' ? 'Start it' : 'Next'}
              </Text>
            )}
          </Pressable>
          {step === 'rooms' ? (
            <Pressable onPress={() => setStep('when')} style={styles.skip} accessibilityRole="button">
              <Text style={styles.skipLabel}>Skip for now</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -Spacing.md,
  },
  step: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  scroll: { maxHeight: 420 },
  question: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.sm, lineHeight: 19 },
  field: { marginBottom: Spacing.md },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  // The pill is ~34px so a rail of them does not outweigh what it describes;
  // the Pressable around it carries the full touch target.
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  footer: { marginTop: Spacing.lg },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  // Disabled goes neutral rather than faded: fern at half strength is a pale
  // sage that reads as broken, and white on it fails contrast on the way past.
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  skip: { alignItems: 'center', paddingVertical: Spacing.md, minHeight: MIN_TOUCH_TARGET },
  skipLabel: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
});
