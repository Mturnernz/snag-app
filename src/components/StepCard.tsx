import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Card from './Card';
import Icon from './Icon';

export type StepStatus = 'done' | 'in_progress' | 'pending' | 'optional';

interface Props {
  title: string;
  status: StepStatus;
  /** One-line summary shown next to the title when collapsed — the detail
   *  isn't lost, just tucked behind a tap (per MVP-SPEC's "progress strip
   *  first, then this user's next step expanded, everything else collapsed"). */
  summary?: string;
  expanded: boolean;
  /** Controlled by the parent (not internal state) so ProgressStrip can
   *  drive the same expanded/collapsed flags as tapping the header directly. */
  onToggle: () => void;
  children: React.ReactNode;
}

const STATUS_COLOR: Record<StepStatus, string> = {
  done: Colors.success,
  in_progress: Colors.status.inProgress,
  pending: Colors.textMuted,
  optional: Colors.textMuted,
};

function StatusDot({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return <Icon name="checkmark-circle" size="md" color={Colors.success} />;
  }
  return (
    <View style={[styles.dot, { borderColor: STATUS_COLOR[status] }, status === 'in_progress' && styles.dotFilled]} />
  );
}

export default function StepCard({ title, status, summary, expanded, onToggle, children }: Props) {
  return (
    <Card variant="elevated" style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
        <StatusDot status={status} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!expanded && summary && (
            <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
          )}
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
      </TouchableOpacity>

      {expanded && <View style={styles.body}>{children}</View>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, marginTop: Spacing.sm, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  summary: { fontSize: Typography.sm, color: Colors.textSecondary },

  dot: {
    width: 20,
    height: 20,
    borderRadius: Radius.avatar,
    borderWidth: 2,
  },
  dotFilled: { backgroundColor: Colors.status.inProgressBg },

  body: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
});
