import React from 'react';
import StateMark from './StateMark';
import { Snag } from '../types';
import { describeDue, dueState } from '@snag/supabase-queries';

interface Props {
  snag: Snag;
}

/**
 * Overdue is the one thing on a household list that has earned red: it's a
 * fact about a date, not a judgement about importance. A repeating snag shows
 * its next date the same way, because "due in 3 months" is what someone needs
 * to know about the gutters, not that it repeats. Drawn as a state mark: clay
 * when late, brass within the week, a hollow graphite dot further out.
 */
export default function DueBadge({ snag }: Props) {
  const state = dueState(snag);
  if (state === 'none') return null;
  const text = describeDue(snag);
  if (!text) return null;
  return (
    <StateMark
      tone={state === 'overdue' ? 'overdue' : state === 'due-soon' ? 'soon' : 'settled'}
      label={text}
    />
  );
}
