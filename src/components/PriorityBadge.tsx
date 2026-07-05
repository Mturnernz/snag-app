import React from 'react';
import { IssuePriority, PRIORITY_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  priority: IssuePriority;
}

export default function PriorityBadge({ priority }: Props) {
  const label = PRIORITY_LABELS[priority];

  if (priority === 'high') {
    return (
      <Badge label={label} color={Colors.priority.high} bg={Colors.priority.highBg} variant="solid" />
    );
  }

  const color = priority === 'medium' ? Colors.priority.medium : Colors.priority.low;
  return <Badge label={label} color={color} variant="dot" />;
}
