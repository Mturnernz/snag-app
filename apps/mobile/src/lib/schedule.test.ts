import {
  dayKey, marksOn, monthGrid, scheduleMarks, SCHEDULE_KIND_LABELS, type ScheduleMark,
} from '@snag/supabase-queries';
import type { Snag } from '../types';

// The Schedule tab is a read of the list, and these pin the three things that
// make that read honest.
//
// **A projected repeat is not a date.** A six-monthly job has exactly one
// `due_at`; every occasion after it is arithmetic, and the day the tab starts
// presenting the two the same way is the day it is lying about what the
// household has agreed to. Marked `next`, drawn hollow.
//
// **A day is a local day.** A calendar cell is a day where the phone is, not a
// day in UTC, and for half the New Zealand year those are different for
// anything after 11am. The suite runs under `TZ=Pacific/Auckland` (see
// apps/mobile/package.json) precisely so this is a real assertion rather than
// one that happens to hold on a UTC runner.
//
// **The grid does not move.** Always 42 cells, always starting on a Monday.

const snag = (over: Partial<Snag> = {}): Snag => ({
  id: 's1', reference: 'S-100', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: 'Gutters', priority: null,
  status: 'open', parts: [], bought: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  reporterId: 'me',
  createdAt: '2026-09-02T03:00:00Z', updatedAt: '2026-09-02T03:00:00Z',
  lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Matt', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  ...over,
});

/** September 2026 and the six weeks the tab would draw for it. */
const SEPT = monthGrid(2026, 8);
const AFTER_SEPT = new Date(
  SEPT[41].getFullYear(), SEPT[41].getMonth(), SEPT[41].getDate() + 1
);

const kinds = (marks: ScheduleMark[], day: string) => marksOn(marks, day).map((m) => m.kind);

describe('dayKey', () => {
  it('is the day where the phone is, not the day in UTC', () => {
    // 2026-09-12 at 23:30 NZST is 11:30 UTC on the 12th — fine. But 11:30pm
    // on the 12th *local* is what a calendar means by "the 12th", and the
    // instant below is stored as the 13th in UTC. Filing it under the 13th is
    // the one fact this function exists to get right.
    expect(dayKey('2026-09-12T12:30:00Z')).toBe('2026-09-13');
    expect(dayKey(new Date(2026, 8, 12, 23, 30))).toBe('2026-09-12');
  });

  it('pads, so the keys sort as dates', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('monthGrid', () => {
  it('is six weeks, starting on a Monday, whatever the month', () => {
    for (const month of [0, 1, 7, 8, 11]) {
      const grid = monthGrid(2026, month);
      expect(grid).toHaveLength(42);
      // getDay() 1 is Monday.
      expect(grid[0].getDay()).toBe(1);
      expect(grid.some((d) => d.getMonth() === month && d.getDate() === 1)).toBe(true);
    }
  });

  it('leads in from the previous month rather than starting the month twice', () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Monday 31 August.
    // The day-of-month arithmetic has to carry the month back itself; an
    // earlier version added to the start date's `getDate()` and produced
    // "31 September" for the second cell.
    const grid = monthGrid(2026, 8);
    expect(dayKey(grid[0])).toBe('2026-08-31');
    expect(dayKey(grid[1])).toBe('2026-09-01');
    expect(dayKey(grid[41])).toBe('2026-10-11');
  });
});

describe('scheduleMarks', () => {
  it('marks the day something was added, and the day it was finished', () => {
    const marks = scheduleMarks(
      [snag({
        createdAt: '2026-09-02T03:00:00Z',
        status: 'done',
        doneAt: '2026-09-09T03:00:00Z',
      })],
      SEPT[0], AFTER_SEPT
    );

    expect(kinds(marks, '2026-09-02')).toEqual(['filed']);
    expect(kinds(marks, '2026-09-09')).toEqual(['done']);
  });

  it('counts one completion once, however many columns hold it', () => {
    // `done_at` and `last_done_at` are both written when a one-off is
    // finished. Two dots on the day would say it happened twice.
    const marks = scheduleMarks(
      [snag({ status: 'done', doneAt: '2026-09-09T03:00:00Z', lastDoneAt: '2026-09-09T03:00:00Z' })],
      SEPT[0], AFTER_SEPT
    );
    expect(kinds(marks, '2026-09-09')).toEqual(['done']);
  });

  it('remembers a repeating job was done, which done_at alone would lose', () => {
    // A repeating snag never reaches 'done', so `done_at` stays null and the
    // completion lands in `last_done_at`. Reading only the former would make
    // the tab claim the heat pump filter has never been changed.
    const marks = scheduleMarks(
      [snag({ status: 'open', doneAt: null, lastDoneAt: '2026-09-05T03:00:00Z' })],
      SEPT[0], AFTER_SEPT
    );
    expect(kinds(marks, '2026-09-05')).toEqual(['done']);
  });

  it('walks a repeat forward, and calls those days something other than due', () => {
    // The whole point of the tab, and the distinction it rests on: one row,
    // one due date, and everything after it arithmetic. A `due` and a `next`
    // that read the same would have the app claiming the household has
    // committed to dates nothing has written.
    const marks = scheduleMarks(
      [snag({ dueAt: '2026-08-04T03:00:00Z', repeatDays: 7 })],
      SEPT[0], AFTER_SEPT
    );

    // The real one is outside the window; the projections inside it are all
    // `next`, on the right days.
    expect(marks.filter((m) => m.kind === 'due')).toHaveLength(0);
    expect(kinds(marks, '2026-09-01')).toEqual(['next']);
    expect(kinds(marks, '2026-09-08')).toEqual(['next']);
    expect(kinds(marks, '2026-09-09')).toEqual([]);
  });

  it('reaches a month years after the date the repeat was set from', () => {
    // A yearly job set up in 2020 is 6 steps behind 2026, a monthly one 70.
    // The walk starts at the snag's own due date, so the cap has to be big
    // enough that paging forward keeps working.
    const marks = scheduleMarks(
      [snag({ dueAt: '2020-09-07T03:00:00Z', repeatDays: 30 })],
      SEPT[0], AFTER_SEPT
    );
    expect(marks.some((m) => m.kind === 'next')).toBe(true);
  });

  it('stops projecting a snag that has been closed', () => {
    const marks = scheduleMarks(
      [snag({ status: 'done', dueAt: '2026-08-04T03:00:00Z', repeatDays: 7, doneAt: '2026-08-04T03:00:00Z' })],
      SEPT[0], AFTER_SEPT
    );
    expect(marks.filter((m) => m.kind === 'next')).toHaveLength(0);
  });

  it('projects nothing for a one-off, however overdue', () => {
    const marks = scheduleMarks(
      [snag({ dueAt: '2026-09-03T03:00:00Z', repeatDays: null })],
      SEPT[0], AFTER_SEPT
    );
    expect(kinds(marks, '2026-09-03')).toEqual(['due']);
    expect(marks.filter((m) => m.kind === 'next')).toHaveLength(0);
  });

  it('keeps to the window it was given', () => {
    const marks = scheduleMarks(
      [snag({ createdAt: '2026-07-01T03:00:00Z', dueAt: '2027-01-01T03:00:00Z' })],
      SEPT[0], AFTER_SEPT
    );
    expect(marks).toHaveLength(0);
  });
});

describe('marksOn', () => {
  it('reads a day as what happened, then what is coming', () => {
    const marks = scheduleMarks(
      [
        snag({ id: 'a', createdAt: '2026-09-10T03:00:00Z' }),
        snag({ id: 'b', dueAt: '2026-09-10T03:00:00Z' }),
        snag({ id: 'c', lastDoneAt: '2026-09-10T03:00:00Z' }),
      ],
      SEPT[0], AFTER_SEPT
    );
    // b and c were filed on the 2nd, so the 10th holds one of each.
    expect(kinds(marks, '2026-09-10')).toEqual(['filed', 'done', 'due']);
  });

  it('does not call a projected occasion "due", because nothing is', () => {
    // Nothing is due then and nothing will be until the current one is marked
    // done and `set_snag_status` rolls the date. "Comes round" is what it is.
    expect(SCHEDULE_KIND_LABELS.next).toBe('Comes round');
    expect(SCHEDULE_KIND_LABELS.due).toBe('Due');
  });
});
