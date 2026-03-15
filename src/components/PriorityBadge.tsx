import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IssuePriority, PRIORITY_LABELS } from '../types';
import { Colors, Radius, Typography } from '../constants/theme';

interface Props {
  priority: IssuePriority;
}

const priorityConfig: Record<
  IssuePriority,
  { label: string; color: string; bg: string }
> = {
  high: { label: PRIORITY_LABELS.high, color: Colors.priority.high, bg: Colors.priority.highBg },
  medium: { label: PRIORITY_LABELS.medium, color: Colors.priority.medium, bg: Colors.priority.mediumBg },
  low: { label: PRIORITY_LABELS.low, color: Colors.priority.low, bg: Colors.priority.lowBg },
};

export default function PriorityBadge({ priority }: Props) {
  const cfg = priorityConfig[priority];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.2,
  },
});
