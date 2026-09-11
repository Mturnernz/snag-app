import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SnagStatus, STATUS_LABELS } from '../types';

interface Props {
  status: SnagStatus;
}

const STYLES: Record<SnagStatus, { color: string; bg: string }> = {
  open: { color: Colors.status.openFg, bg: Colors.status.openBg },
  doing: { color: Colors.status.doingFg, bg: Colors.status.doingBg },
  done: { color: Colors.status.doneFg, bg: Colors.status.doneBg },
};

export default function StatusBadge({ status }: Props) {
  const tone = STYLES[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.label, { color: tone.color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs / 2,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
});
