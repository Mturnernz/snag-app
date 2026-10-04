import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';

/**
 * *Serviced by Aircon Experts* — who looks after a thing, as *Schedule service*
 * asked it (`spec.servicedBy`). A label, never a control: it is a fact about
 * the thing, shown on the house record's card and on a job's *Linked items*,
 * where it is the name somebody wants when the heat pump plays up.
 *
 * The app's one chip shape, sunken and unbordered, and no hue: it is neither a
 * state nor something to press. Nothing at all when nobody said.
 */
export default function ServicedByPill({ by }: { by: string | null | undefined }) {
  const name = by?.trim();
  if (!name) return null;
  return (
    <View style={styles.pill}>
      <Icon name="construct-outline" size="sm" color={Colors.textMuted} />
      <Text style={styles.label} numberOfLines={1}>Serviced by {name}</Text>
    </View>
  );
}

/** `spec.servicedBy` as a string, or null — `spec` is jsonb and holds anything. */
export function servicedByOf(spec: { servicedBy?: unknown } | null | undefined): string | null {
  const value = spec?.servicedBy;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunken,
  },
  label: { flexShrink: 1, fontSize: Typography.xs, color: Colors.textSecondary },
});
