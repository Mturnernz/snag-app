import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import Icon, { type IconName } from './Icon';
import { Colors, Shadow, Spacing } from '../constants/theme';

/**
 * The floating + in a screen's bottom-right corner — the House tab's way to
 * record a thing and the List tab's way to capture a job. One component so the
 * two cannot drift apart in size, colour or reach.
 *
 * 56pt, comfortably over `MIN_TOUCH_TARGET`, and `Spacing.lg` in from the edge,
 * which is above the tab bar and clear of the corner curve. A screen that has
 * something else pinned to the bottom passes `bottom` to sit above it.
 */
export default function Fab({
  onPress, accessibilityLabel, icon = 'add', bottom = Spacing.lg, disabled = false,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: IconName;
  bottom?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.fab, { bottom }, disabled && styles.off]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Icon name={icon} size="xl" color={Colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.lg,
  },
  off: { backgroundColor: Colors.textMuted },
});
