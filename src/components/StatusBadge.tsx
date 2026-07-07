import React from 'react';
import { SnagStatus, STATUS_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  status: SnagStatus;
}

const statusConfig: Record<SnagStatus, { color: string; bg: string }> = {
  flagged: { color: Colors.status.flagged, bg: Colors.status.flaggedBg },
  in_progress: { color: Colors.status.inProgress, bg: Colors.status.inProgressBg },
  resolved: { color: Colors.status.resolved, bg: Colors.status.resolvedBg },
  rca_pending: { color: Colors.status.rcaPending, bg: Colors.status.rcaPendingBg },
};

export default function StatusBadge({ status }: Props) {
  const cfg = statusConfig[status];
  return <Badge label={STATUS_LABELS[status]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
