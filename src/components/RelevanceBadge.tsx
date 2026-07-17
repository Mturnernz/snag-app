import React from 'react';
import { SnagRelevanceReason, RELEVANCE_REASON_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  reason: SnagRelevanceReason;
}

const relevanceConfig: Record<SnagRelevanceReason, { color: string; bg: string }> = {
  rca_pending: { color: Colors.relevance.rcaPending, bg: Colors.relevance.rcaPendingBg },
  assigned: { color: Colors.relevance.assigned, bg: Colors.relevance.assignedBg },
  tagged: { color: Colors.relevance.tagged, bg: Colors.relevance.taggedBg },
  reported: { color: Colors.relevance.reported, bg: Colors.relevance.reportedBg },
};

export default function RelevanceBadge({ reason }: Props) {
  const cfg = relevanceConfig[reason];
  return <Badge label={RELEVANCE_REASON_LABELS[reason]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
