import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

import { RcaWhyStep, saveRcaWhy } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Icon from './Icon';
import Sheet from './Sheet';

export const WHY_INDICES = [1, 2, 3, 4, 5];

interface Props {
  rcaId: string;
  /** Whatever has been saved so far — sparse until all five are answered. */
  whys: RcaWhyStep[];
  /** The problem statement why #1 is asked of. */
  problem: string;
  /** False for a reviewer reading a submitted analysis. */
  canEdit: boolean;
  onSaved: () => void;
}

// The 5 Whys, asked one at a time.
//
// This replaced ten text inputs stacked in a single card. Two problems with
// that: on a phone it was the same wall of look-alike fields the investigation
// panel had, and more importantly it misrepresents the method. The 5 Whys is a
// chain — why #2 is asked *of the answer to* #1 — and a form showing all five
// at once invites five parallel guesses at the same question instead of one
// line of reasoning.
//
// So each step opens a sheet carrying the previous answer as its premise, and
// saves on close. Save-as-you-go also removed the old "Save Draft" button: with
// per-step saves there is no separate draft to keep.
export default function WhyChain({ rcaId, whys, problem, canEdit, onSaved }: Props) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [whyText, setWhyText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [saving, setSaving] = useState(false);

  const byIndex = new Map(whys.map((w) => [w.whyIndex, w]));
  const isComplete = (i: number) =>
    Boolean(byIndex.get(i)?.whyText.trim() && byIndex.get(i)?.answerText.trim());

  /** The first unanswered step — the only one offered as the next action. */
  const nextIndex = WHY_INDICES.find((i) => !isComplete(i)) ?? null;

  /** What this why is asked of: the problem for #1, the previous answer after. */
  const premiseFor = (i: number) =>
    i === 1 ? problem : byIndex.get(i - 1)?.answerText ?? '';

  function open(i: number) {
    const existing = byIndex.get(i);
    setWhyText(existing?.whyText ?? '');
    setAnswerText(existing?.answerText ?? '');
    setEditing(i);
  }

  function close() {
    setEditing(null);
    setWhyText('');
    setAnswerText('');
  }

  async function handleSave() {
    if (editing === null) return;
    if (!whyText.trim() || !answerText.trim()) {
      showToast('Add both the question and the answer');
      return;
    }
    setSaving(true);
    const { error } = await saveRcaWhy(rcaId, editing, whyText.trim(), answerText.trim());
    setSaving(false);
    if (error) showToast(error.message ?? 'Could not save this step');
    else { close(); onSaved(); }
  }

  return (
    <View style={styles.chain}>
      {WHY_INDICES.map((i) => {
        const step = byIndex.get(i);
        const done = isComplete(i);
        const isNext = i === nextIndex;
        // Steps beyond the next unanswered one stay closed: answering #4
        // before #3 exists would have nothing to be asked of.
        const reachable = done || isNext;

        return (
          <View key={i} style={styles.step}>
            <View style={styles.rail}>
              <View style={[styles.marker, done && styles.markerDone, isNext && styles.markerNext]}>
                {done ? (
                  <Icon name="checkmark" size="sm" color={Colors.white} />
                ) : (
                  <Text style={[styles.markerNum, isNext && styles.markerNumNext]}>{i}</Text>
                )}
              </View>
              {i < WHY_INDICES.length && <View style={[styles.connector, done && styles.connectorDone]} />}
            </View>

            <TouchableOpacity
              style={styles.body}
              onPress={() => open(i)}
              disabled={!canEdit || !reachable}
              activeOpacity={0.7}
            >
              {done && step ? (
                <>
                  <Text style={styles.question}>{step.whyText}</Text>
                  <Text style={styles.answer}>{step.answerText}</Text>
                </>
              ) : isNext ? (
                <>
                  <Text style={styles.nextLabel}>
                    {i === 1 ? 'Why did this happen?' : 'Why did that happen?'}
                  </Text>
                  <Text style={styles.premise} numberOfLines={2}>
                    Asked of: {premiseFor(i) || 'the incident'}
                  </Text>
                </>
              ) : (
                <Text style={styles.pending}>Why {i}</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      })}

      <Sheet
        visible={editing !== null}
        title={editing === 1 ? 'Why did this happen?' : 'Why did that happen?'}
        subtitle={editing !== null ? `Asked of: ${premiseFor(editing) || 'the incident'}` : undefined}
        submitLabel={`Save why ${editing ?? ''}`.trim()}
        onSubmit={handleSave}
        submitting={saving}
        submitDisabled={!whyText.trim() || !answerText.trim()}
        onClose={close}
      >
        <Text style={styles.label}>The question</Text>
        <TextInput
          style={styles.input}
          placeholder={editing === 1 ? 'e.g. Why did the forklift enter the walkway?' : 'Why did that happen?'}
          placeholderTextColor={Colors.textMuted}
          value={whyText}
          onChangeText={setWhyText}
          autoFocus
        />

        <Text style={styles.label}>The answer</Text>
        <TextInput
          style={[styles.input, styles.inputTall]}
          placeholder="Because…"
          placeholderTextColor={Colors.textMuted}
          value={answerText}
          onChangeText={setAnswerText}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.sheetHint}>
          The next why is asked of this answer, so keep it to the one cause that mattered.
        </Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  chain: { gap: 0 },
  step: { flexDirection: 'row', gap: Spacing.sm },

  rail: { alignItems: 'center', width: 26 },
  marker: {
    width: 26,
    height: 26,
    borderRadius: Radius.avatar,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  markerDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  markerNext: { borderColor: Colors.status.inProgress, backgroundColor: Colors.status.inProgressBg },
  markerNum: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textMuted },
  markerNumNext: { color: Colors.status.inProgress },
  connector: { flex: 1, width: 2, backgroundColor: Colors.border, minHeight: Spacing.md },
  connectorDone: { backgroundColor: Colors.success },

  body: { flex: 1, paddingBottom: Spacing.lg, minHeight: MIN_TOUCH_TARGET - 10, gap: 2 },
  question: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary, lineHeight: 21 },
  answer: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 20 },
  nextLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.status.inProgress },
  premise: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19, fontStyle: 'italic' },
  pending: { fontSize: Typography.base, color: Colors.textMuted },

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
  inputTall: { minHeight: 120, lineHeight: 21 },
  sheetHint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
});
