import {
  historyEntries, historyMonths, monthLabel, searchSnags, snagAbout, snagsWithNewNotes,
} from '@snag/supabase-queries';
import type { Snag } from '../types';

// The October 2026 function review's three list basics: search across open and
// finished jobs, history past the seven days the list keeps, and a note from
// the other person counting as news.

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p', linkedThings: [],
  room: null, photoPaths: [], description: null, status: 'open', needsParts: false, parts: [], bought: [],
  dueAt: null, repeatDays: null, thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null, projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', reporterName: 'Me', propertyName: 'Home', commentCount: 0,
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', lastDoneAt: null, doneAt: null,
  ...over,
} as Snag);

describe('searching jobs', () => {
  const jobs = [
    snag({ id: 'a', reference: 'SNAG-0042', description: 'Dripping mixer', room: 'Kitchen' }),
    snag({ id: 'b', description: 'Shelf', room: 'Garage', parts: ['Wall plugs'] }),
    snag({
      id: 'c', description: 'Noisy', room: 'Lounge',
      linkedThings: [{ id: 't', name: 'Heat pump', room: 'Lounge', make: 'Mitsubishi', model: 'MSZ-GS60VFD', kind: 'appliance' }],
    }),
    snag({ id: 'd', description: null, room: 'Bathroom' }),
  ];

  it('finds every word typed, anywhere, in any case', () => {
    expect(searchSnags(jobs, 'kitchen MIXER').map((s) => s.id)).toEqual(['a']);
    expect(searchSnags(jobs, 'plugs').map((s) => s.id)).toEqual(['b']);
    expect(searchSnags(jobs, 'gs60').map((s) => s.id)).toEqual(['c']);
    expect(searchSnags(jobs, 'snag-0042').map((s) => s.id)).toEqual(['a']);
  });

  it('finds a photo-only job by the headline the list gives it', () => {
    expect(searchSnags(jobs, 'something in the bathroom').map((s) => s.id)).toEqual(['d']);
  });

  it('returns everything for an empty search, and nothing for a miss', () => {
    expect(searchSnags(jobs, '  ')).toHaveLength(4);
    expect(searchSnags(jobs, 'roof')).toEqual([]);
  });
});

describe('what a job is about, for an extract', () => {
  it('names every linked item with its make and model, from the links', () => {
    expect(snagAbout(snag({
      thingName: 'Old link', linkedThings: [
        { id: '1', name: 'Mixer', room: 'Kitchen', make: 'Methven', model: 'Kiri', kind: 'appliance' },
        { id: '2', name: 'Waste trap', room: 'Kitchen', make: null, model: null, kind: 'appliance' },
      ],
    }))).toBe('Mixer Methven Kiri; Waste trap');
  });

  it('is empty with no links, whatever thing_id once said', () => {
    expect(snagAbout(snag({ thingName: 'Heat pump' }))).toBe('');
  });
});

describe('history', () => {
  const doneJob = snag({ id: 'gutters', status: 'done', doneAt: '2026-10-03T08:00:00Z' });
  const septJob = snag({ id: 'shelf', status: 'done', doneAt: '2026-09-20T08:00:00Z' });
  const repeat = snag({ id: 'filter', repeatDays: 90, lastDoneAt: '2026-10-10T08:00:00Z' });
  const neverDone = snag({ id: 'tap' });

  it('lists the done jobs and each repeat at its last time, newest first', () => {
    const entries = historyEntries([doneJob, septJob], [repeat, neverDone]);
    expect(entries.map((e) => [e.snag.id, e.repeat])).toEqual([
      ['filter', true], ['gutters', false], ['shelf', false],
    ]);
  });

  it('groups by local month, the newest month first', () => {
    const months = historyMonths(historyEntries([doneJob, septJob], [repeat]));
    expect(months.map((m) => [m.label, m.entries.length])).toEqual([['October 2026', 2], ['September 2026', 1]]);
  });

  it('files a job finished late on the last evening of a month in that month, in Auckland', () => {
    // 10:30 UTC on 31 October is 11:30pm that night in Auckland (NZDT): an
    // October job, whatever a UTC slice of the timestamp would say about the
    // day after.
    const late = snag({ id: 'late', status: 'done', doneAt: '2026-10-31T10:30:00Z' });
    expect(historyMonths(historyEntries([late], []))[0].key).toBe('2026-10');
  });

  it('names a month in words', () => {
    expect(monthLabel('2026-01')).toBe('January 2026');
  });
});

describe('a note as news', () => {
  const since = '2026-10-10T00:00:00Z';
  const notes = [
    { snagId: 'a', authorId: 'sam', createdAt: '2026-10-11T00:00:00Z' },
    { snagId: 'a', authorId: 'sam', createdAt: '2026-10-12T00:00:00Z' },
    { snagId: 'b', authorId: 'me', createdAt: '2026-10-12T00:00:00Z' },
    { snagId: 'c', authorId: 'sam', createdAt: '2026-10-09T00:00:00Z' },
  ];

  it("counts somebody else's notes since the last visit, by job", () => {
    expect([...snagsWithNewNotes(notes, 'me', since)]).toEqual([['a', 2]]);
  });

  it('is nothing on a first visit', () => {
    expect(snagsWithNewNotes(notes, 'me', null).size).toBe(0);
  });
});
