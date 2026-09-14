import { firstStep } from './AmendSnagSheet';
import type { Snag } from '../types';

// Which question gets asked first, and why.
//
// A photo with no words and no room is the weakest thing this app can hold —
// `snagHeadline` has nothing to work with and the list reads "Something to sort
// out", which is unreadable a fortnight later to the person who filed it. So a
// wordless snag is asked what it is. A snag that arrived as typed words is
// already its own description; asking again would be asking twice.

const snag = (over: Partial<Snag> = {}): Snag => ({
  id: 's1', reference: 'S-100', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: null, priority: null,
  status: 'open', parts: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  reporterId: 'me', createdAt: '', updatedAt: '', lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Matt', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null,
  ...over,
});

describe('where the sheet opens', () => {
  it('asks a photo-only snag what is wrong', () => {
    expect(firstStep(snag({ photoPaths: ['h/a.jpg'] }))).toBe('note');
  });

  it('skips straight to the room when the snag arrived as words', () => {
    expect(firstStep(snag({ description: 'Gutters need clearing' }))).toBe('room');
  });

  it('treats a photo taken after typing as already having its words', () => {
    // The compose bar carries whatever is in the field onto the photo, so this
    // snag has both and needs neither asked.
    expect(firstStep(snag({ photoPaths: ['h/a.jpg'], description: 'Hinge sheared' }))).toBe('room');
  });
});
