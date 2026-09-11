import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SnagEffort, EFFORT_SHORT_LABELS } from '../types';

interface Props {
  effort: SnagEffort | null;
  /** The hardware-store flag. Shown here because the two are read together. */
  needsParts?: boolean;
}

/**
 * Effort is deliberately colourless. It answers "can I finish this today",
 * which is not an alarm — giving it a hue would put it in competition with
 * priority and due state on a card that already carries both.
 *
 * Needing parts *is* worth a glyph, because it's the thing that quietly blocks
 * a small job for weeks and the reason the weekend view collects them.
 */
export default function EffortBadge({ effort, needsParts }: Props) {
  if (!effort && !needsParts) return null;
  return (
    <View style={styles.badge}>
      {effort ? <Text style={styles.label}>{EFFORT_SHORT_LABELS[effort]}</Text> : null}
      {needsParts ? (
        <>
          {effort ? <Text style={styles.separator}>·</Text> : null}
          <Icon name="cart-outline" size="sm" color={Colors.effort.fg} />
          <Text style={styles.label}>Parts</Text>
        </>
      ) : null}
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
    backgroundColor: Colors.effort.bg,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    color: Colors.effort.fg,
  },
  separator: { fontSize: Typography.xs, color: Colors.textMuted },
});
