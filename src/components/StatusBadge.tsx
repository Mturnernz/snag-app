import React from 'react';
import { IssueStatus, STATUS_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  status: IssueStatus;
}

const statusConfig: Record<IssueStatus, { color: string; bg: string }> = {
  open: { color: Colors.status.open, bg: Colors.status.openBg },
  in_progress: { color: Colors.status.inProgress, bg: Colors.status.inProgressBg },
  resolved: { color: Colors.status.resolved, bg: Colors.status.resolvedBg },
  closed: { color: Colors.status.closed, bg: Colors.status.closedBg },
};

export default function StatusBadge({ status }: Props) {
  const cfg = statusConfig[status];
  return <Badge label={STATUS_LABELS[status]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
