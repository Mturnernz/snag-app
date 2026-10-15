import React from 'react';
import StateMark from './StateMark';
import { SnagStatus, STATUS_LABELS } from '../types';

interface Props {
  status: SnagStatus;
}

/** A job's status as a state mark: slate open, brass doing, graphite done. */
export default function StatusBadge({ status }: Props) {
  return (
    <StateMark
      tone={status === 'done' ? 'settled' : status}
      label={STATUS_LABELS[status]}
    />
  );
}
