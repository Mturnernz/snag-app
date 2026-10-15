import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Colors, Spacing, Typography } from '../constants/theme';

export type MarkTone = 'open' | 'doing' | 'overdue' | 'soon' | 'settled';

const HUES: Record<MarkTone, string> = {
  open: Colors.status.open,
  doing: Colors.status.doing,
  overdue: Colors.due.overdueFg,
  soon: Colors.due.soonFg,
  settled: Colors.textSecondary,
};

/**
 * A state, as Bone & Glass draws one: **a dot and a word**, never a filled
 * badge. The three state hues appear here and nowhere else — slate open, brass
 * doing and due soon, clay overdue — and done, or a repeat parked until it
 * comes round, is a hollow graphite dot. The word is always there, so a state
 * is never colour alone.
 */
export default function StateMark({ tone, label }: { tone: MarkTone; label: string }) {
  const hue = HUES[tone];
  const hollow = tone === 'settled';
  return (
    <View style={styles.mark}>
      <View
        style={[styles.dot, hollow ? { borderColor: hue, borderWidth: 1.5 } : { backgroundColor: hue }]}
      />
      <Text style={[styles.label, { color: hue }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, alignSelf: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: Typography.footnote, fontWeight: Typography.semibold },
});
