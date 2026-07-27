import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import Button from './Button';
import Card from './Card';
import Icon from './Icon';

export interface NextStep {
  /** Imperative — what to do now, not what is missing. */
  title: string;
  /** One line of supporting context, usually a count. */
  detail: string;
  /** Label for the action that takes you there. */
  cta: string;
  /** Gate conditions still unmet, including this one. 0 once resolvable. */
  remaining: number;
}

interface Props {
  /** null once the resolve gate is clear. */
  step: NextStep | null;
  /** Opens the step this card is pointing at. */
  onGo: () => void;
  /** Opens Manage, where Resolve itself lives. */
  onGoToResolve: () => void;
}

// The single answer to "what do I do now" on a serious snag, sitting directly
// under the header so it lands above the fold.
//
// It replaces two things that used to disagree with each other: the horizontal
// ProgressStrip (which clipped at phone width) and a prominent Resolve button
// placed before the work, whose blocking reason was the smallest text on the
// screen. Resolve is stated here as a locked row while it's unreachable —
// naming the gate instead of offering an action the server will refuse.
export default function NextStepCard({ step, onGo, onGoToResolve }: Props) {
  if (!step) {
    return (
      <Card variant="elevated" style={[styles.card, styles.cardReady]}>
        <View style={styles.labelRow}>
          <Icon name="checkmark-circle" size="sm" color={Colors.success} />
          <Text style={[styles.label, styles.labelReady]}>Ready to resolve</Text>
        </View>
        <Text style={styles.title}>Everything's recorded</Text>
        <Text style={styles.detail}>
          The checklist, witness, evidence, root cause, and corrective actions are all complete.
        </Text>
        <Button label="Resolve this snag" onPress={onGoToResolve} fullWidth />
      </Card>
    );
  }

  return (
    <Card variant="elevated" style={styles.card}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Next step</Text>
      </View>
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.detail}>{step.detail}</Text>

      <Button label={step.cta} onPress={onGo} fullWidth />

      <View style={styles.lockedRow}>
        <Icon name="lock-closed-outline" size="sm" color={Colors.textMuted} />
        <Text style={styles.lockedText}>
          Resolve — blocked, {step.remaining} {step.remaining === 1 ? 'step' : 'steps'} remaining
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.xs,
    // A left rail in the in-progress colour, so the card reads as "live work"
    // at a glance without competing with the serious lane's red header.
    borderLeftWidth: 4,
    borderLeftColor: Colors.status.inProgress,
  },
  cardReady: { borderLeftColor: Colors.success },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.status.inProgress,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  labelReady: { color: Colors.success },

  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    lineHeight: 26,
  },
  detail: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.xs,
  },

  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  lockedText: {
    flex: 1,
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
});
