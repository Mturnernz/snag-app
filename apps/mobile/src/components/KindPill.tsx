import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  /** What the paper is: *Invoice*, *Quote*, *Paperwork*. */
  label: string;
  /** Marks a kind the email reader guessed rather than read. */
  guessed?: boolean;
  /** Makes the pill the way to change it. Absent, it is a label and nothing more. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Where it sits in its parent; it hugs the start of the line unless told otherwise. */
  style?: StyleProp<ViewStyle>;
}

/**
 * What a piece of money paper is, said on the paper's own row.
 *
 * **One pill, three places**: an emailed card, a price's own sheet and every
 * row under *Quotes and bills*. A room's list mixes the two kinds, and a row
 * reading *Not agreed yet* only implied it was a quote — the pill says so.
 *
 * **Colourless on purpose.** The palette spends its four hues on state and
 * interaction, and a kind is neither: it is a fact about the paper, the same
 * reason the parts pill on a job's card has no hue. The sunken chip is the one
 * the emailed card already used.
 *
 * Where it can be changed it carries a chevron and a 48pt target around a
 * ~22pt chip, pulled back with negative margins so the row it sits in stays
 * the height of its text — the split every chip in this app makes, since
 * `hitSlop` does nothing on the build people install.
 */
export default function KindPill({ label, guessed, onPress, accessibilityLabel, style }: Props) {
  const chip = (
    <View style={[styles.chip, !onPress && style]}>
      <Text style={styles.label}>{label}</Text>
      {guessed ? <Text style={styles.guessed}>guessed</Text> : null}
      {onPress ? <Icon name="chevron-down" size={12} color={Colors.textSecondary} /> : null}
    </View>
  );
  if (!onPress) return chip;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tap, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}. Change what it is`}
    >
      {chip}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  label: { fontSize: Typography.xs, color: Colors.textSecondary },
  guessed: { fontSize: Typography.xs, color: Colors.textMuted, fontStyle: 'italic' },
  tap: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginVertical: -13,
  },
});
