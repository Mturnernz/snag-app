import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ChecklistStep, CHECKLIST_STEPS, CHECKLIST_STEP_LABELS } from '../types';
import { InvestigationState, completeChecklistStep } from '../lib/supabase';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Icon from './Icon';

interface Props {
  issueId: string;
  state: InvestigationState;
  onChanged: () => void;
}

// The five first-response steps. Split out of the old InvestigationPanel,
// which held these plus witnesses, evidence, and root cause in a single
// drawer — four separate tasks behind one heading.
//
// These rows were already the best-sized elements on the screen: a full-width
// tap target each, unambiguous state. They just sat two scrolls down. Nothing
// about them changes here beyond now having a card to themselves.
export default function ChecklistPanel({ issueId, state, onChanged }: Props) {
  const { showToast } = useToast();
  const [busyStep, setBusyStep] = useState<ChecklistStep | null>(null);

  async function handleStep(step: ChecklistStep) {
    if (state.completedSteps.includes(step) || busyStep) return;
    setBusyStep(step);
    const { error } = await completeChecklistStep(issueId, step);
    setBusyStep(null);
    if (error) showToast(error.message ?? 'Could not update checklist');
    else onChanged();
  }

  return (
    <View>
      {CHECKLIST_STEPS.map((step) => {
        const done = state.completedSteps.includes(step);
        return (
          <TouchableOpacity
            key={step}
            style={styles.row}
            onPress={() => handleStep(step)}
            disabled={done || busyStep !== null}
            activeOpacity={0.7}
          >
            <Icon
              name={done ? 'checkmark-circle' : 'ellipse-outline'}
              size="md"
              color={done ? Colors.success : Colors.textMuted}
            />
            <Text style={[styles.label, done && styles.labelDone]}>
              {CHECKLIST_STEP_LABELS[step]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET - 8,
  },
  label: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  labelDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
});
