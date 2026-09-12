import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SnagPriority, PRIORITY_LABELS } from '../types';

interface Props {
  priority: SnagPriority | null;
}

/**
 * Only `high` carries an alert colour; `low` is a neutral dot. Same reason the
 * retired product only coloured its top severity: a second saturated hue on the
 * same card collides with the status badge and neither reads.
 *
 * `low` still renders rather than hiding. Priority is set at capture on every
 * snag, so a missing badge would mean "nobody has looked at this", not "this
 * can wait" — and those are different things.
 */
const STYLES: Record<SnagPriority, { color: string; bg: string }> = {
  high: { color: Colors.priority.high, bg: Colors.priority.highBg },
  low: { color: Colors.priority.low, bg: Colors.priority.lowBg },
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
