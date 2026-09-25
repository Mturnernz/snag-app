import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import DateField from './DateField';
import Sheet from './Sheet';
import { PrimaryButton, Segmented } from './Grouped';
import { Colors, Typography } from '../constants/theme';
import { dayKey, formatDayFirst, parseLooseDate } from '@snag/supabase-queries';
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '../types';

export interface ProjectStatusUpdate {
  status: ProjectStatus;
  /** Null clears the column; absent leaves it as it is. */
  startedOn?: string | null;
  finishedOn?: string | null;
}

interface Props {
  visible: boolean;
  status: ProjectStatus;
  startedOn: string | null;
  finishedOn: string | null;
  onSave: (update: ProjectStatusUpdate) => Promise<void>;
  onClose: () => void;
}

const OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'planned', label: PROJECT_STATUS_LABELS.planned },
  { value: 'underway', label: PROJECT_STATUS_LABELS.underway },
  { value: 'done', label: PROJECT_STATUS_LABELS.done },
];

/**
 * Where a project is up to, and the dates that go with it.
 *
 * Status was asked once, when a project was started, and never again: nothing
 * on the page could move a renovation from Planned to Underway or mark it
 * Complete. The pill under the project's name opens this, which costs the page
 * no height — the inline chips that used to sit there were removed for exactly
 * that rent.
 *
 * **The dates ride with the status**, because each move has one: going
 * underway is when it started, completing is when it finished. An empty box is
 * filled with today the moment the status that needs it is chosen, so the
 * common case is one tap and Done, and it can still be changed to the day it
 * really happened. Moving away from Complete clears the finish date — a
 * project that is not finished has not finished on the 12th — and moving back
 * to Planned leaves the start date alone rather than forgetting it.
 *
 * **One write, on Done**, and the button is the saving rule's own exception:
 * a sheet editing two fields together. A date the calendar has not got holds
 * the sheet open with the words still in the box.
 */
export default function ProjectStatusSheet({
  visible, status: current, startedOn, finishedOn, onSave, onClose,
}: Props) {
  const [status, setStatus] = useState<ProjectStatus>(current);
  const [started, setStarted] = useState('');
  const [finished, setFinished] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStatus(current);
    setStarted(formatDayFirst(startedOn));
    setFinished(formatDayFirst(finishedOn));
    setError(null);
    setBusy(false);
  }, [visible, current, startedOn, finishedOn]);

  function pick(next: ProjectStatus) {
    setStatus(next);
    setError(null);
    const today = formatDayFirst(dayKey(new Date()));
    if (next !== 'planned' && !started.trim()) setStarted(today);
    if (next === 'done' && !finished.trim()) setFinished(today);
  }

  async function save() {
    if (busy) return;
    const startIso = status === 'planned' ? null : parseLooseDate(started);
    const finishIso = status === 'done' ? parseLooseDate(finished) : null;
    if (startIso === undefined) { setError('The start date isn’t a day the calendar has.'); return; }
    if (finishIso === undefined) { setError('The finish date isn’t a day the calendar has.'); return; }

    const today = dayKey(new Date());
    const update: ProjectStatusUpdate = { status };
    if (status === 'underway') {
      update.startedOn = startIso ?? today;
      if (finishedOn !== null) update.finishedOn = null;
    } else if (status === 'done') {
      update.startedOn = startIso;
      update.finishedOn = finishIso ?? today;
    } else if (finishedOn !== null) {
      update.finishedOn = null;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(update);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title="Where’s it up to?"
      onClose={onClose}
      footer={<PrimaryButton label="Done" onPress={save} busy={busy} />}
    >
      <Segmented<ProjectStatus>
        options={OPTIONS}
        value={status}
        onChange={pick}
        accessibilityLabel="Where the project is up to"
      />
      {status !== 'planned' ? (
        <DateField label="Started" value={started} onChangeValue={setStarted} pickerTitle="When did it start?" />
      ) : null}
      {status === 'done' ? (
        <DateField label="Finished" value={finished} onChangeValue={setFinished} pickerTitle="When did it finish?" />
      ) : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
