import React, { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

import DateField from './DateField';
import Sheet from './Sheet';
import { PrimaryButton, Segmented } from './Grouped';
import { Colors, Typography } from '../constants/theme';
import {
  dayKey, defaultStartDate, formatDayFirst, orderProjectDates, parseLooseDate, type ProjectDateBox,
} from '@snag/supabase-queries';
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
 * **A project cannot finish before it started.** An empty *Started* box is
 * filled with the finish when the finish is already in the past, never with
 * today. And when either box is left holding a day on the wrong side of the
 * other, the box somebody just changed wins and the other moves to meet it,
 * with one line saying which moved (`orderProjectDates`). Done applies the same
 * rule once more, because on native a press does not reliably blur a box.
 *
 * **One write, on Done**, and the button is the saving rule's own exception:
 * a sheet editing two fields together. A date the calendar has not got holds
 * the sheet open with the words still in the box. Pressing the status already
 * chosen does nothing, as every chip row here does.
 */
export default function ProjectStatusSheet({
  visible, status: current, startedOn, finishedOn, onSave, onClose,
}: Props) {
  const [status, setStatus] = useState<ProjectStatus>(current);
  const [started, setStarted] = useState('');
  const [finished, setFinished] = useState('');
  const [moved, setMoved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What is in each box, beside the state: the calendar fills a box and blurs
  // it in one gesture, before React has re-rendered, so a blur handler reading
  // the state would order the day that was there before the pick.
  const boxes = useRef({ started: '', finished: '' });
  // The box changed last, which wins when the two cross. The finish by default,
  // because a finish is what somebody marking a job complete is answering.
  const lastEdited = useRef<ProjectDateBox>('finished');

  const put = (box: ProjectDateBox, text: string) => {
    boxes.current[box] = text;
    if (box === 'started') setStarted(text);
    else setFinished(text);
  };

  useEffect(() => {
    if (!visible) return;
    setStatus(current);
    put('started', formatDayFirst(startedOn));
    put('finished', formatDayFirst(finishedOn));
    setMoved(null);
    setError(null);
    setBusy(false);
    lastEdited.current = 'finished';
  }, [visible, current, startedOn, finishedOn]);

  function pick(next: ProjectStatus) {
    if (next === status) return;
    setStatus(next);
    setError(null);
    setMoved(null);
    const today = dayKey(new Date());
    if (next === 'done' && !boxes.current.finished.trim()) put('finished', formatDayFirst(today));
    if (next !== 'planned' && !boxes.current.started.trim()) {
      const finishIso = next === 'done' ? parseLooseDate(boxes.current.finished) : null;
      put('started', formatDayFirst(defaultStartDate(finishIso ?? null, today)));
    } else if (next === 'done') {
      // A start already in the box that the finish would sit before — a
      // planned start later than today, say — moves to meet it.
      order('finished');
    }
  }

  /**
   * Puts the two boxes in order when both hold a real day, moving whichever was
   * not `edited`, and says so. Anything unreadable is left for Done to refuse.
   */
  function order(edited: ProjectDateBox): { startIso: string | null | undefined; finishIso: string | null | undefined } {
    const startIso = parseLooseDate(boxes.current.started);
    const finishIso = parseLooseDate(boxes.current.finished);
    if (!startIso || !finishIso) return { startIso, finishIso };
    const next = orderProjectDates(startIso, finishIso, edited);
    if (next.moved) {
      const day = formatDayFirst(next.moved === 'started' ? next.startedOn : next.finishedOn);
      put(next.moved, day);
      setMoved(`${next.moved === 'started' ? 'Started' : 'Finished'} moved to ${day} — a job can’t finish before it starts.`);
    }
    return { startIso: next.startedOn, finishIso: next.finishedOn };
  }

  function type(box: ProjectDateBox, text: string) {
    lastEdited.current = box;
    put(box, text);
  }

  function leave(box: ProjectDateBox) {
    lastEdited.current = box;
    if (status === 'done') order(box);
  }

  async function save() {
    if (busy) return;
    const { startIso, finishIso } = status === 'done'
      ? order(lastEdited.current)
      : { startIso: status === 'planned' ? null : parseLooseDate(boxes.current.started), finishIso: null };
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
        <DateField
          label="Started"
          value={started}
          onChangeValue={(text) => type('started', text)}
          onBlur={() => leave('started')}
          pickerTitle="When did it start?"
        />
      ) : null}
      {status === 'done' ? (
        <DateField
          label="Finished"
          value={finished}
          onChangeValue={(text) => type('finished', text)}
          onBlur={() => leave('finished')}
          pickerTitle="When did it finish?"
        />
      ) : null}
      {moved ? <Text style={styles.moved} accessibilityLiveRegion="polite">{moved}</Text> : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
  moved: { fontSize: Typography.sm, color: Colors.textSecondary, paddingHorizontal: 4 },
});
