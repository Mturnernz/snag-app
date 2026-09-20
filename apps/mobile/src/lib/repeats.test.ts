import { describeDue, dueState, isDoneForNow } from '@snag/supabase-queries';
import type { Snag } from '../types';

// A repeating job is the one thing on this list that cannot be finished. The
// RPC rolls `due_at` forward and leaves the status open, so "done" for a repeat
// means *done for now* — and the list has to be able to tell that apart from
// both an ordinary open job and a real finish, because it dims one and not the
// others.

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  room: 'Outside', photoPaths: [], description: 'Gutters', status: 'open',
  parts: [], bought: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

describe('done for now', () => {
  it('is a repeat that has been done and is waiting for its next turn', () => {
    expect(isDoneForNow(snag({
      repeatDays: 180, lastDoneAt: at(-1), dueAt: at(179),
    }))).toBe(true);
  });

  // The distinction the whole treatment rests on: the gutters due on Saturday
  // are an ordinary job and belong in Outside with everything else.
  it('is not merely having a repeat', () => {
    expect(isDoneForNow(snag({ repeatDays: 180, dueAt: at(3) }))).toBe(false);
  });

  it('is not a repeat whose date has come round again', () => {
    // Done six months ago, due yesterday: there is work to do, so it comes
    // back up the list on its own, with no write anywhere.
    expect(isDoneForNow(snag({
      repeatDays: 180, lastDoneAt: at(-181), dueAt: at(-1),
    }))).toBe(false);
  });

  it('is not a one-off, however recently it was done', () => {
    expect(isDoneForNow(snag({ lastDoneAt: at(-1), dueAt: at(30) }))).toBe(false);
  });

  it('is not a finished snag, which leaves the list on its own', () => {
    expect(isDoneForNow(snag({
      repeatDays: 180, status: 'done', doneAt: at(-1), lastDoneAt: at(-1), dueAt: at(179),
    }))).toBe(false);
  });

  it('leaves the due badge saying what it always said', () => {
    // Dimming is a fact about attention, not about the date. The badge still
    // reads the date, so a parked job can still be opened and read.
    const parked = snag({ repeatDays: 180, lastDoneAt: at(-1), dueAt: at(179) });
    expect(dueState(parked)).toBe('scheduled');
    expect(describeDue(parked)).not.toBeNull();
  });
});
