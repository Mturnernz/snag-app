import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import Icon from './Icon';
import { StepStatus } from './StepCard';

export interface ProgressStripItem {
  key: string;
  label: string;
  status: StepStatus;
}

interface Props {
  items: ProgressStripItem[];
  onPress: (key: string) => void;
}

// "Progress strip first" — MVP-SPEC's UX north star. A tap toggles the same
// expanded flag the matching StepCard's own header does, so this is just a
// second way in, not a separate source of truth.
export default function ProgressStrip({ items, onPress }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={[styles.pill, styles[`pill_${item.status}` as const]]}
          onPress={() => onPress(item.key)}
          activeOpacity={0.7}
        >
          {item.status === 'done' ? (
            <Icon name="checkmark-circle" size="sm" color={Colors.success} />
          ) : (
            <View style={[styles.dot, styles[`dot_${item.status}` as const]]} />
          )}
          <Text style={[styles.label, styles[`label_${item.status}` as const]]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
  },
  pill_done: { backgroundColor: Colors.successBg, borderColor: Colors.successBorder },
  pill_in_progress: { backgroundColor: Colors.status.inProgressBg, borderColor: Colors.status.inProgress },
  pill_pending: { backgroundColor: Colors.background, borderColor: Colors.border },
  pill_optional: { backgroundColor: Colors.background, borderColor: Colors.border },

  dot: { width: 10, height: 10, borderRadius: Radius.avatar },
  dot_in_progress: { backgroundColor: Colors.status.inProgress },
  dot_pending: { backgroundColor: Colors.textMuted },
  dot_optional: { backgroundColor: Colors.textMuted },

  label: { fontSize: Typography.sm, fontWeight: Typography.semibold },
  label_done: { color: Colors.success },
  label_in_progress: { color: Colors.status.inProgress },
  label_pending: { color: Colors.textSecondary },
  label_optional: { color: Colors.textSecondary },
});
