import React from 'react';
import { SnagStatus, STATUS_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  status: SnagStatus;
}

const statusConfig: Record<SnagStatus, { color: string; bg: string }> = {
  // *Fg, not the base hue: this is label text on the tint. See theme.ts.
  flagged: { color: Colors.status.flaggedFg, bg: Colors.status.flaggedBg },
  in_progress: { color: Colors.status.inProgressFg, bg: Colors.status.inProgressBg },
  resolved: { color: Colors.status.resolvedFg, bg: Colors.status.resolvedBg },
  rca_pending: { color: Colors.status.rcaPendingFg, bg: Colors.status.rcaPendingBg },
};

export default function StatusBadge({ status }: Props) {
  const cfg = statusConfig[status];
  return <Badge label={STATUS_LABELS[status]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
