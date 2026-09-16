import { shoppingCount, shoppingList, unboughtParts } from '@snag/supabase-queries';
import type { Snag } from '../types';

// The trip to the shop is the single most common reason a small job sits for a
// fortnight, and the list could not record the trip: you bought the seal and it
// went on asking for the seal. What these pin is the half-done state — one
// person in an aisle with four items and two of them in the trolley.

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: 'A thing', status: 'open', priority: null,
  parts: [], bought: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

describe('what is still to get', () => {
  it('is the list less what has been bought', () => {
    const job = snag({ parts: ['Seal', 'Wall plugs', 'Hinge'], bought: ['Wall plugs'] });
    expect(unboughtParts(job)).toEqual(['Seal', 'Hinge']);
  });

  it('is nothing once the trip is done', () => {
    expect(unboughtParts(snag({ parts: ['Seal'], bought: ['Seal'] }))).toEqual([]);
  });

  it('ignores a tick for something no longer on the list', () => {
    // `update_snag` clears these server-side when the list is replaced, but a
    // client holding a stale row must not count one either.
    const job = snag({ parts: ['Seal'], bought: ['Seal', 'Something removed'] });
    expect(unboughtParts(job)).toEqual([]);
  });
});

describe('the trip sheet', () => {
  const seal = snag({ id: 'a', room: 'Bathroom', parts: ['Seal', 'Washer'], bought: ['Washer'] });
  const gutter = snag({ id: 'b', room: 'Outside', parts: ['Brackets'] });

  it('collects every job’s parts, unbought first', () => {
    // Unbought is the half being read in the aisle.
    expect(shoppingList([seal, gutter]).map((row) => row.item))
      .toEqual(['Seal', 'Brackets', 'Washer']);
  });

  it('keeps what has been got, struck through rather than gone', () => {
    // A tap in a shop lands on the wrong row often enough that a list which
    // silently drops the thing you just touched is a dead end — you would have
    // to remember which job it belonged to to put it back.
    const rows = shoppingList([seal, gutter]);
    expect(rows.find((row) => row.item === 'Washer')?.bought).toBe(true);
    expect(rows.find((row) => row.item === 'Seal')?.bought).toBe(false);
  });

  it('says which job each item is for', () => {
    const rows = shoppingList([seal, gutter]);
    expect(rows.find((row) => row.item === 'Brackets')?.snag.room).toBe('Outside');
  });

  it('counts only what is left, across everything', () => {
    // The pill is how somebody finds out there is shopping to do, so it counts
    // the whole list rather than what a lens already reveals.
    expect(shoppingCount([seal, gutter])).toBe(2);
    expect(shoppingCount([])).toBe(0);
  });
});
