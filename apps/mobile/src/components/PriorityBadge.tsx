import React from 'react';
import { SnagSeverity, SEVERITY_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  severity: SnagSeverity | null;
}

export default function PriorityBadge({ severity }: Props) {
  if (!severity) return null;
  const label = SEVERITY_LABELS[severity];

  if (severity === 'critical') {
    return <Badge label={label} color={Colors.priority.high} bg={Colors.priority.highBg} variant="solid" />;
  }
  if (severity === 'injury') {
    return <Badge label={label} color={Colors.category.brokenEquipment} bg={Colors.category.brokenEquipmentBg} variant="solid" />;
  }

  const color = severity === 'moderate' ? Colors.priority.medium : Colors.priority.low;
  return <Badge label={label} color={color} variant="dot" />;
}
