import type { Snag, Tables } from '../lib/supabase';

// The serious-snag journey, visible to every role. Derived entirely from
// existing data: checklist completeness, investigation row, RCA status,
// open action count, snag status.
interface Props {
  snag: Snag;
  checklistCount: number;
  hasRootCause: boolean;
  rca: Tables<'snag_rca'> | null;
  openActionCount: number;
}

type StepState = 'done' | 'current' | 'upcoming';

export default function ProgressStrip({ snag, checklistCount, hasRootCause, rca, openActionCount }: Props) {
  const firstResponseDone = checklistCount >= 5;
  const investigationDone = hasRootCause;
  const rcaDone = rca?.status === 'accepted';
  const rcaActive = rca != null && rca.status !== 'accepted';
  const sorted = snag.status === 'sorted';

  const steps: { label: string; state: StepState }[] = [];

  steps.push({ label: 'Reported', state: 'done' });
  steps.push({
    label: 'First response',
    state: firstResponseDone ? 'done' : 'current',
  });
  steps.push({
    label: 'Investigation',
    state: investigationDone ? 'done' : firstResponseDone ? 'current' : 'upcoming',
  });
  steps.push({
    label: 'RCA',
    state: rcaDone ? 'done' : rcaActive ? 'current' : 'upcoming',
  });
  steps.push({
    label: 'Actions',
    state:
      openActionCount === 0 && investigationDone
        ? 'done'
        : openActionCount > 0
          ? 'current'
          : 'upcoming',
  });
  steps.push({
    label: 'Sorted',
    state: sorted && !rcaActive ? 'done' : 'upcoming',
  });

  // Only one step reads as "current": the first non-done one that claimed it.
  let currentSeen = false;
  const normalised = steps.map((s) => {
    if (s.state === 'current') {
      if (currentSeen) return { ...s, state: 'upcoming' as StepState };
      currentSeen = true;
    }
    return s;
  });

  return (
    <div className="progress-strip">
      {normalised.map((s) => (
        <div key={s.label} className={`progress-step ${s.state === 'upcoming' ? '' : s.state}`}>
          {s.state === 'done' ? '✓ ' : ''}{s.label}
        </div>
      ))}
    </div>
  );
}
