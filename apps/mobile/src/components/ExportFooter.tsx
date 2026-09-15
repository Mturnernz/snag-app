import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  label: string;
  onPress: () => void;
}

/**
 * The way into an extract, at the foot of a list.
 *
 * It goes in `ListFooterComponent` — the end of the scrolled content — and
 * **not** pinned to the bottom of the screen, which on the List tab is the
 * compose bar. Everything there is friction at the moment friction costs most,
 * and an export button is the opposite of that: it is a thing you go looking
 * for once a month, at a desk. Reaching the foot of the list is the cheapest
 * possible place to put something that rare.
 *
 * Drawn like the *Add a room* line it sits under: muted, no fill, no border.
 * It is not an action the screen is recommending.
 */
export default function ExportFooter({ label, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name="download-outline" size="sm" color={Colors.textMuted} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.md,
  },
  label: { fontSize: Typography.sm, color: Colors.textMuted },
});
