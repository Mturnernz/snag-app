import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IssueStatus, STATUS_LABELS } from '../types';
import { Colors, Radius, Typography } from '../constants/theme';

interface Props {
  status: IssueStatus;
}

const statusConfig: Record<
  IssueStatus,
  { label: string; color: string; bg: string }
> = {
  open: { label: STATUS_LABELS.open, color: Colors.status.open, bg: Colors.status.openBg },
  in_progress: { label: STATUS_LABELS.in_progress, color: Colors.status.inProgress, bg: Colors.status.inProgressBg },
  resolved: { label: STATUS_LABELS.resolved, color: Colors.status.resolved, bg: Colors.status.resolvedBg },
  closed: { label: STATUS_LABELS.closed, color: Colors.status.closed, bg: Colors.status.closedBg },
};

export default function StatusBadge({ status }: Props) {
  const cfg = statusConfig[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.2,
  },
});
