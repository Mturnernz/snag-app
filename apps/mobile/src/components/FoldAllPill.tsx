import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  /** True while any section is still open — decides both the word and the chevron. */
  anyOpen: boolean;
  onPress: () => void;
}

/**
 * The one control that reaches every room at once, on the List tab — its own
 * sections and the trip sheet's rooms together.
 *
 * **One component, so that a surface folding rooms away never invents a second
 * control for it.** The House tab used it too until each room there became a
 * page of its own; if rooms are ever folded somewhere else, this is the control.
 *
 * **It says what pressing it does**, deciding from whether anything is still
 * open, so the press on offer is never a no-op: with every room already folded
 * it reads *Expand all*, and with any room open it reads *Collapse all*, which
 * is what somebody scanning a long list actually wants.
 *
 * It is a pill rather than a bare chevron beside a word. On a plaster ground an
 * unbounded glyph and a line of muted text reads as a *caption* — something the
 * screen is telling you — and this is something to press. The app's one chip
 * shape says so instead: a sunken well, no border, the label inside it. It
 * stays sunken in both states because it is a momentary action rather than a
 * filter that is on or off, and solid fern is reserved for the latter.
 */
export default function FoldAllPill({ anyOpen, onPress }: Props) {
  const label = anyOpen ? 'Collapse all' : 'Expand all';
  return (
    <Pressable
      onPress={onPress}
      style={styles.tap}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* The pill is ~34px and the tap area is the full 48: a control *about*
          the list must not outweigh the list, and a 34px target is invisible
          until somebody is holding the phone one-handed. */}
      <View style={styles.pill}>
        <Icon name={anyOpen ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textSecondary} />
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
});
