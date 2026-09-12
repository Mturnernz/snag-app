import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { Snag } from '../types';
import { describeDue, dueState } from '@snag/supabase-queries';

interface Props {
  snag: Snag;
}

const TONES = {
  overdue: { fg: Colors.due.overdueFg, bg: Colors.due.overdueBg },
  'due-soon': { fg: Colors.due.soonFg, bg: Colors.due.soonBg },
  scheduled: { fg: Colors.due.scheduledFg, bg: Colors.due.scheduledBg },
} as const;

/**
 * Overdue is the one thing on a household list that has earned red: it's a
 * fact about a date, not a judgement about importance. A repeating snag shows
 * its next date the same way, because "due in 3 months" is what someone needs
 * to know about the gutters, not that it repeats.
 */
export default function DueBadge({ snag }: Props) {
  const state = dueState(snag);
  if (state === 'none') return null;

  const tone = TONES[state];
  const text = describeDue(snag);
  if (!text) return null;

  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Icon
        name={snag.repeatDays ? 'repeat-outline' : 'calendar-outline'}
        size="sm"
        color={tone.fg}
      />
      <Text style={[styles.label, { color: tone.fg }]}>{text}</Text>
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
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
});
