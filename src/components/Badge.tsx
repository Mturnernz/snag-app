import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';

interface Props {
  label: string;
  color: string;
  bg?: string;
  /** 'solid' is a tinted pill (for status/category — states worth calling out).
   *  'dot' is a small coloured dot + neutral label (for low-signal values like
   *  low/medium priority) so it doesn't visually compete with status pills. */
  variant?: 'solid' | 'dot';
}

export default function Badge({ label, color, bg, variant = 'solid' }: Props) {
  if (variant === 'dot') {
    return (
      <View style={styles.dotBadge}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.dotLabel}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.2,
  },
  dotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
});
