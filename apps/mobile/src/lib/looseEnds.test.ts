import { looseEnds, scheduleMarks, type LooseEnd } from '@snag/supabase-queries';
import type { Project, Property, Snag } from '../types';

/**
 * What the app knows is half-finished, and what it refuses to nag about.
 *
 * The rule these are built against is already written down for the House tab: a
 * global completeness meter is the shaming number that gets an app closed and
 * not reopened. So the interesting assertions here are the ones about what is
 * **not** listed.
 */

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
  summary: null, status: 'underway',
  startedOn: null, targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0, installedCount: 0,
  partsBudgetTotal: null, partsBudgetedCount: 0,
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  forecastDerived: null, committedDerived: null, invoicedDerived: null, paidDerived: null,
  forecastOverride: null, committedOverride: null, invoicedOverride: null, paidOverride: null,
  forecastNote: null, committedNote: null, invoicedNote: null, paidNote: null,
  partsEditedCount: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  additionalOpen: 0,
  ...over,
});

const snag = (over: Partial<Snag> = {}): Snag => ({
  id: 's1', reference: 'SNG-0142', householdId: 'h', propertyId: 'prop',
  room: null, photoPaths: ['a.jpg'], description: null, priority: null,
  status: 'open', parts: [], bought: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null, projectId: null, projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Kate', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null, projectName: null,
  ...over,
});

const property = (over: Partial<Property> = {}): Property => ({
  id: 'prop', householdId: 'h', name: 'Home', suburb: 'Titirangi', town: 'Auckland',
  ...over,
});

const kinds = (ends: LooseEnd[]) => ends.map((e) => e.kind);

describe('what a renovation has not handed over', () => {
  it('names the gap between what was installed and what was recorded', () => {
    const ends = looseEnds({
      projects: [project({ installedCount: 3, thingCount: 1 })],
      snags: [],
      properties: [property()],
    });
    expect(kinds(ends)).toEqual(['record-installed']);
    expect(ends[0].title).toContain('2 things');
    expect(ends[0].projectId).toBe('p1');
  });

  it('says nothing once everything installed has been recorded', () => {
    const ends = looseEnds({
      projects: [project({ installedCount: 3, thingCount: 3 })],
      snags: [],
      properties: [property()],
    });
    expect(ends).toEqual([]);
  });

  it('does not invent work when more is recorded than the project installed', () => {
    // Somebody recording the old dishwasher alongside the new one is not a
    // loose end, and a negative subtraction rendered as a count would be
    // nonsense on screen.
    const ends = looseEnds({
      projects: [project({ installedCount: 1, thingCount: 4 })],
      snags: [],
      properties: [property()],
    });
    expect(ends).toEqual([]);
  });

  it('leaves a project alone while nothing is installed yet', () => {
    // Quoted, chosen, ordered — none of those put anything in the house. Listing
    // a project that has not finished anything would be nagging about work in
    // progress, which is the whole failure mode this is built against.
    const ends = looseEnds({
      projects: [project({ itemCount: 9, pricedCount: 5, installedCount: 0 })],
      snags: [],
      properties: [property()],
    });
    expect(ends).toEqual([]);
  });
});

describe('a photo with no words', () => {
  it('is listed, because the list reads "Something to sort out" without it', () => {
    const ends = looseEnds({ projects: [], snags: [snag()], properties: [property()] });
    expect(kinds(ends)).toEqual(['wordless-snag']);
    expect(ends[0].snagId).toBe('s1');
  });

  it('is not listed once it has words', () => {
    const ends = looseEnds({
      projects: [], snags: [snag({ description: 'Cistern drips' })], properties: [property()],
    });
    expect(ends).toEqual([]);
  });

  it('is not listed once it has a room', () => {
    // Either one gives `snagHeadline` something to work with.
    const ends = looseEnds({
      projects: [], snags: [snag({ room: 'Bathroom' })], properties: [property()],
    });
    expect(ends).toEqual([]);
  });

  it('leaves a finished job alone whatever it was called', () => {
    // There is nothing to sort out about a job that is done, so asking somebody
    // to describe it is asking for tidiness rather than for anything useful.
    const ends = looseEnds({
      projects: [], snags: [snag({ status: 'done' })], properties: [property()],
    });
    expect(ends).toEqual([]);
  });
});

describe('a place that cannot say where it is', () => {
  it('is listed, because a brief cannot ask for somebody local without it', () => {
    const ends = looseEnds({
      projects: [], snags: [], properties: [property({ suburb: null, town: null })],
    });
    expect(kinds(ends)).toEqual(['place-unlocated']);
  });

  it('is satisfied by either half', () => {
    expect(looseEnds({
      projects: [], snags: [], properties: [property({ suburb: null })],
    })).toEqual([]);
    expect(looseEnds({
      projects: [], snags: [], properties: [property({ town: null })],
    })).toEqual([]);
  });
});

describe('what it refuses to say', () => {
  it('is empty for a household with nothing outstanding', () => {
    // And an empty list draws nothing at all — a control at zero is a control
    // dressed as a choice, the same rule as the shopping pill and *Fit*.
    expect(looseEnds({
      projects: [project()], snags: [snag({ description: 'Gutters' })], properties: [property()],
    })).toEqual([]);
  });

  it('never reports a total of everything, only things to do', () => {
    // No denominator anywhere in the shape: nothing here can be rendered as
    // "12 of 40" or a percentage, which is the meter this must never become.
    const ends = looseEnds({
      projects: [project({ installedCount: 2, thingCount: 0, itemCount: 40 })],
      snags: [],
      properties: [property()],
    });
    for (const end of ends) {
      expect(end.title).not.toMatch(/\bof\s+\d+/);
      expect(end.title).not.toContain('%');
    }
  });
});

describe('projects on the calendar', () => {
  const from = new Date(2026, 8, 1);
  const to = new Date(2026, 9, 1);

  it('marks the days a project started and finished', () => {
    const marks = scheduleMarks([], from, to, [
      project({ startedOn: '2026-09-04', finishedOn: '2026-09-20' }),
    ]);
    expect(marks.map((m) => [m.day, m.note])).toEqual([
      ['2026-09-04', 'Started'],
      ['2026-09-20', 'Finished'],
    ]);
    expect(marks.every((m) => m.kind === 'project' && m.snag === null)).toBe(true);
  });

  it('never calls a target date "Due"', () => {
    // Nothing is due then — it is a hope somebody typed, and "Due" is the one
    // word this tab must not spend loosely.
    const marks = scheduleMarks([], from, to, [project({ targetOn: '2026-09-25' })]);
    expect(marks[0].note).toBe('Aiming to finish');
    expect(marks.map((m) => m.note)).not.toContain('Due');
  });

  it('drops a target that has already been met', () => {
    const marks = scheduleMarks([], from, to, [
      project({ targetOn: '2026-09-25', finishedOn: '2026-09-20' }),
    ]);
    expect(marks.map((m) => m.note)).toEqual(['Finished']);
  });

  it('leaves the snag marks exactly as they were', () => {
    // A project mark is an addition to this tab, not a change to it — every
    // existing caller passes no projects at all.
    const marks = scheduleMarks([], from, to);
    expect(marks).toEqual([]);
  });
});
