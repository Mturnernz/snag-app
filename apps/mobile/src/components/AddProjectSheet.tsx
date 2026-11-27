import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Text, TextInput } from './Text';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import MoneyField from './MoneyField';
import DateField from './DateField';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  parseLooseDate, formatDayFirst, formatLooseDate, orderProjectDates, type ProjectDateBox, type ProjectInput,
} from '@snag/supabase-queries';
import { ProjectStatus, PROJECT_STATUS_LABELS } from '../types';

type Step = 'name' | 'when';
const STEPS: Step[] = ['name', 'when'];

interface Props {
  visible: boolean;
  propertyId: string;
  onCancel: () => void;
  onCreate: (input: ProjectInput) => Promise<void>;
}

/**
 * Starting a project, in two steps, of which only the name is required.
 *
 * The same bargain `AddThingSheet` makes and for the same reason: every
 * house-inventory product ever shipped opens on an empty thirty-field form, and
 * the record ends up 8% complete — which is worse than none, because you check
 * it once, find nothing, and never check again. A project with a name and
 * nothing else is a perfectly good row.
 *
 * **No rooms step since the November 2026 reset.** A project is its
 * suppliers and their quotes and invoices; the server still makes one
 * implicit part, which nothing draws.
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
 * Nothing is written until the last step: a project half-created by somebody
 * who walked away mid-flow is a row nobody asked for.
 */
export default function AddProjectSheet({
  visible, propertyId, onCancel, onCreate,
}: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const [startedOn, setStartedOn] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [finishedOn, setFinishedOn] = useState('');
  const [datesMoved, setDatesMoved] = useState<string | null>(null);
  // What is in the two boxes, beside the state, for the reason the status
  // sheet gives: the calendar writes and blurs a box before React re-renders.
  const dates = useRef({ started: '', finished: '' });
  const lastDate = useRef<ProjectDateBox>('finished');
  const [budget, setBudget] = useState('');
  const [budgetIncl, setBudgetIncl] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('name');
    setName('');
    setStatus('planned');
    setStartedOn('');
    setTargetOn('');
    setFinishedOn('');
    setDatesMoved(null);
    dates.current = { started: '', finished: '' };
    lastDate.current = 'finished';
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

  function typeDate(box: ProjectDateBox, text: string) {
    dates.current[box] = text;
    lastDate.current = box;
    if (box === 'started') setStartedOn(text);
    else setFinishedOn(text);
  }

  /**
   * An already-finished project cannot have finished before it started. The box
   * just changed wins and the other moves to meet it — `ProjectStatusSheet`'s
   * rule, from the one other place both dates are asked.
   */
  function orderDates(edited: ProjectDateBox): { started: string | null; finished: string | null } {
    const started = parseLooseDate(dates.current.started) ?? null;
    const finished = parseLooseDate(dates.current.finished) ?? null;
    if (status !== 'done') return { started, finished };
    const next = orderProjectDates(started, finished, edited);
    if (next.moved) {
      const day = formatDayFirst(next.moved === 'started' ? next.startedOn : next.finishedOn);
      dates.current[next.moved] = day;
      if (next.moved === 'started') setStartedOn(day);
      else setFinishedOn(day);
      setDatesMoved(`${next.moved === 'started' ? 'Started' : 'Finished'} moved to ${day}`);
    }
    return { started: next.startedOn, finished: next.finishedOn };
  }

  async function save() {
    if (busy || !name.trim()) return;
    const ordered = orderDates(lastDate.current);
    setBusy(true);
    try {
      await onCreate({
        propertyId,
        name: name.trim(),
        status,
        startedOn: ordered.started,
        targetOn: parseLooseDate(targetOn) ?? null,
        finishedOn: ordered.finished,
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
            Step {index + 1} of {STEPS.length}{step === 'name' ? ' · required' : ''}
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
          </View>
        ) : null}

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
              <DateField
                label="Started"
                value={startedOn}
                onChangeValue={(text) => typeDate('started', text)}
                onBlur={() => { lastDate.current = 'started'; orderDates('started'); }}
                pickerTitle="When did it start?"
              />
            ) : null}

            {status === 'done' ? (
              <DateField
                label="Finished"
                value={finishedOn}
                onChangeValue={(text) => typeDate('finished', text)}
                onBlur={() => { lastDate.current = 'finished'; orderDates('finished'); }}
                pickerTitle="When did it finish?"
              />
            ) : (
              <DateField
                label="Hoping to finish"
                value={targetOn}
                onChangeValue={setTargetOn}
                placeholder="No date — that’s fine"
                pickerTitle="Hoping to finish by"
              />
            )}

            {datesMoved && status === 'done' ? (
              <Text style={styles.hint} accessibilityLiveRegion="polite">{datesMoved}</Text>
            ) : null}

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
            onPress={() =>
              step === 'when' ? save() : setStep(STEPS[index + 1])
            }
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  sheet: {
    // The app's column on a wide screen (AppColumn): a Modal is drawn over
    // the whole page, so the sheet keeps itself to the same width.
    width: '100%', maxWidth: 640, marginHorizontal: 'auto',
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
  chipOn: { backgroundColor: Colors.selected },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  chipNew: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  chipNewLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  newRoomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  newRoomInput: {
    // A TextInput on web is an <input> with an intrinsic ~20-character width
    // that `min-width: auto` will not shrink below, so anything flexed around
    // one needs minWidth: 0 or it grows past the sheet.
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  newRoomGo: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
