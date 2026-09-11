import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SnagPriority, PRIORITY_LABELS } from '../types';

interface Props {
  priority: SnagPriority | null;
}

/**
 * Only `now` carries an alert colour. `soon` and `someday` render as neutral
 * dots, for the same reason the retired product did it: a second saturated hue
 * on the same card collides with the status badge and neither reads.
 */
const STYLES: Record<SnagPriority, { color: string; bg: string }> = {
  now: { color: Colors.priority.now, bg: Colors.priority.nowBg },
  soon: { color: Colors.priority.soon, bg: Colors.priority.soonBg },
  someday: { color: Colors.priority.someday, bg: Colors.priority.somedayBg },
};

export default function PriorityBadge({ priority }: Props) {
  if (!priority) return null;
  const tone = STYLES[priority];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <View style={[styles.dot, { backgroundColor: tone.color }]} />
      <Text style={[styles.label, { color: tone.color }]}>{PRIORITY_LABELS[priority]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs / 2,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
});
