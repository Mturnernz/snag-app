import React from 'react';
import TestRenderer from 'react-test-renderer';
import AmendSnagSheet, { amendSteps, firstStep } from './AmendSnagSheet';
import { render, type RenderResult } from '../test/render';
import type { Location, Snag } from '../types';

jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

// Which question gets asked first, and why.
//
// A photo with no words and no room is the weakest thing this app can hold —
// `snagHeadline` has nothing to work with and the list reads "Something to sort
// out", which is unreadable a fortnight later to the person who filed it. So a
// wordless snag is asked what it is. A snag that arrived as typed words is
// already its own description; asking again would be asking twice.

const snag = (over: Partial<Snag> = {}): Snag => ({
  id: 's1', reference: 'S-100', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: null,
  status: 'open', parts: [], bought: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  reporterId: 'me', createdAt: '', updatedAt: '', lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Matt', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  ...over,
});

const rooms: Location[] = [
  { id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 },
  { id: 'l2', propertyId: 'p', name: 'Bathroom', sortOrder: 1 },
  { id: 'l3', propertyId: 'p', name: 'Under the house', sortOrder: 2 },
];

const textOf = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');

const byLabel = (result: RenderResult, label: string) =>
  result.root.findAll(
    (n) => typeof n.type !== 'string' && !!n.props?.onPress && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

/** One row of the room list, which names itself for a screen reader. */
const row = byLabel;

/** The search box, which is a field rather than something you press. */
const field = (result: RenderResult, label: string) =>
  result.root.findAll(
    (n) => typeof n.type !== 'string' && !!n.props?.onChangeText
      && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

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

// ------------------------------------------------------------- two questions
//
// It asked four. *Is it about one of these?* wrote `snags.thing_id` from the
// room's recorded appliances; the job's own page lists what is in the room to
// read instead. *Does it need doing now?* went with priority itself — nearly
// everything on a household list is filed as not urgent, which is the premise
// of the product rather than a finding, so the question spent a whole step of
// the one sheet with ten seconds of patience collecting an assumed answer.
//
// What is left is the two things only answerable here, with the thing still in
// front of you.

describe('what it asks', () => {
  it('asks two things, always', () => {
    expect(amendSteps()).toEqual(['note', 'room']);
  });

  it('never asks what it is about, or how urgent it is', async () => {
    const result = render(
      <AmendSnagSheet
        snag={snag({ photoPaths: ['h/a.jpg'] })}
        locations={rooms}
        onSaveNote={jest.fn()}
        onSetRoom={jest.fn()}
        onOpenDetail={jest.fn()}
        onClose={jest.fn()}
      />
    );
    await TestRenderer.act(async () => { byLabel(result, 'Skip for now').props.onPress(); });

    const prose = result.getAllByType('Text').map(textOf);
    expect(prose).toContain('Where is it?');
    expect(prose.some((t) => t.includes('Is it about one of these'))).toBe(false);
    expect(prose.some((t) => t.includes('Does it need doing now'))).toBe(false);
    expect(prose.some((t) => t === 'Urgent' || t === 'Not urgent')).toBe(false);
  });

  it('counts two steps in the header, never three or four', async () => {
    const result = render(
      <AmendSnagSheet
        snag={snag({ description: 'Gutters' })}
        locations={rooms}
        onSaveNote={jest.fn()}
        onSetRoom={jest.fn()}
        onOpenDetail={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(result.queryByText('On the list · 2 of 2')).not.toBeNull();
  });

  it('asks its questions and explains none of them', async () => {
    // Every step used to carry a paragraph under its question, on a sheet whose
    // whole argument is that it costs nothing to walk away from.
    const result = render(
      <AmendSnagSheet
        snag={snag({ photoPaths: ['h/a.jpg'] })}
        locations={rooms}
        onSaveNote={jest.fn()}
        onSetRoom={jest.fn()}
        onOpenDetail={jest.fn()}
        onClose={jest.fn()}
      />
    );
    const prose = result.getAllByType('Text').map(textOf);
    expect(prose).toContain("What's wrong?");
    expect(prose.some((t) => t.includes('A few words is plenty'))).toBe(false);
    expect(prose.some((t) => t.includes('The list groups by room'))).toBe(false);
  });
});

// ------------------------------------------------------------ the room step
//
// Every room is offered, never a shortlist — the one you want is the one you
// are standing in, and that is as likely to be the Roof as the Kitchen. It was
// a rail of chips, which makes that claim in a way that stops scaling the
// moment a household adds rooms to the seeded twelve.

describe('choosing the room', () => {
  async function openOnRoom(over: Partial<Snag> = {}) {
    const onSetRoom = jest.fn().mockResolvedValue(undefined);
    const onOpenDetail = jest.fn();
    const result = render(
      <AmendSnagSheet
        snag={snag({ description: 'Gutters', ...over })}
        locations={rooms}
        onSaveNote={jest.fn()}
        onSetRoom={onSetRoom}
        onOpenDetail={onOpenDetail}
        onClose={jest.fn()}
      />
    );
    return { result, onSetRoom, onOpenDetail };
  }

  it('offers every room without being asked to open', async () => {
    const { result } = await openOnRoom();
    expect(row(result, 'Kitchen')).toBeDefined();
    expect(row(result, 'Bathroom')).toBeDefined();
    expect(row(result, 'Under the house')).toBeDefined();
  });

  it('narrows on a substring, anywhere in the name', async () => {
    // "house" finding *Under the house* is the case a prefix match answers
    // with silence, and a picker that comes back empty for a room that exists
    // is worse than no search at all.
    const { result } = await openOnRoom();
    await TestRenderer.act(async () => {
      field(result, 'Search rooms').props.onChangeText('house');
    });
    expect(row(result, 'Under the house')).toBeDefined();
    expect(row(result, 'Kitchen')).toBeUndefined();
  });

  it('says so rather than going blank when nothing matches', async () => {
    const { result } = await openOnRoom();
    await TestRenderer.act(async () => {
      field(result, 'Search rooms').props.onChangeText('conservatory');
    });
    const prose = result.getAllByType('Text').map(textOf);
    expect(prose.some((t) => t.includes('No room called'))).toBe(true);
  });

  it('writes the room, and clears it when the chosen one is pressed again', async () => {
    const { result, onSetRoom } = await openOnRoom();
    await TestRenderer.act(async () => { row(result, 'Kitchen').props.onPress(); });
    expect(onSetRoom).toHaveBeenCalledWith('Kitchen');

    const already = await openOnRoom({ room: 'Kitchen' });
    await TestRenderer.act(async () => { row(already.result, 'Kitchen').props.onPress(); });
    expect(already.onSetRoom).toHaveBeenCalledWith(null);
  });

  // Finishing capture opens the job. Dropping back onto the list would end the
  // one moment somebody is certainly thinking about this job by showing them
  // every other one.
  it('opens the job when the last step is finished with', async () => {
    const { result, onOpenDetail } = await openOnRoom();
    await TestRenderer.act(async () => { byLabel(result, 'Submit').props.onPress(); });
    expect(onOpenDetail).toHaveBeenCalled();
  });
});
