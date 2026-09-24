import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import ReviewEditSheet from './ReviewEditSheet';
import type { InvoiceReview, ProjectElement } from '../types';

// Where a bill that was emailed in is put right before it counts. It writes only
// to the card — allocating stays the card's own button — and it cannot save a
// figure or a date it cannot read.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const review: InvoiceReview = {
  id: 'r1', projectId: 'p1', elementId: null, kind: 'invoice', addressedTo: null, sourcePart: 0,
  supplier: 'Reliabuilder', detail: null, amount: 43987.5, amountInclGst: true,
  invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: 'em_1', sourceSubject: 'Fwd: Claim 2', sourceFrom: 'sam@example.com', sourceAt: null,
  inferred: ['supplier'], state: 'pending', quoteId: null, decidedAt: null,
  createdAt: '2026-09-20T00:00:00Z', photoPaths: [], documentPaths: ['h1/docs/1-2-INV.pdf'], roomIds: [], roomAmounts: null,
};

const element = (id: string, name: string, implicit = false) =>
  ({ id, projectId: 'p1', name, room: name, implicit } as unknown as ProjectElement);

const boxes = (r: RenderResult): Record<string, any> => {
  const found: Record<string, any> = {};
  r.root
    .findAll((n) => typeof n.type === 'string' && !!n.props.accessibilityLabel && 'onChangeText' in n.props, { deep: true })
    .forEach((n) => { found[n.props.accessibilityLabel] = n; });
  return found;
};
const tap = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];

async function open(
  elements: ProjectElement[] = [],
  over: Partial<InvoiceReview> = {},
  onAddRoom = jest.fn().mockResolvedValue(null),
) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(
      <ReviewEditSheet
        review={{ ...review, ...over }}
        elements={elements}
        locations={[]}
        onAddRoom={onAddRoom}
        onSave={onSave}
        onClose={onClose}
      />,
    );
  });
  return { r, onSave, onClose };
}

it('loads what the card holds, dates day first', async () => {
  const { r } = await open();
  const b = boxes(r);
  expect(b['Who it’s from'].props.value).toBe('Reliabuilder');
  expect(b['Invoice number'].props.value).toBe('INV-0208');
  expect(r.root.findAll((n) => n.props.value === '20/09/2026', { deep: true }).length).toBeGreaterThan(0);
});

it('writes a correction to the card, an emptied box as a clear, and the one room ticked', async () => {
  const { r, onSave, onClose } = await open([element('e1', 'Bathroom'), element('e2', 'Laundry')]);
  await TestRenderer.act(async () => {
    boxes(r)['Who it’s from'].props.onChangeText('ReliaBuilder');
    boxes(r)['Invoice number'].props.onChangeText('');
  });
  await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
  await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      supplier: 'ReliaBuilder', invoiceNumber: null, amount: 43987.5, amountInclGst: true,
      dated: '2026-09-20', dueOn: null,
    }),
    // One room is the bill on that room: nothing to split.
    { ids: ['e2'], amounts: null },
  );
  expect(onClose).toHaveBeenCalled();
});

it('does not offer a part that nobody has seen', async () => {
  const { r } = await open([element('e1', 'Downstairs laundry', true)]);
  expect(r.queryByText('Downstairs laundry')).toBeNull();
  expect(r.queryByText('None ticked — it goes on the whole job.')).not.toBeNull();
});

describe('more than one room', () => {
  const rooms = [element('e1', 'Bathroom'), element('e2', 'Laundry'), element('e3', 'Workshop')];

  it('splits evenly by default, to the cent, against the figure being saved', async () => {
    const { r, onSave } = await open(rooms, { amount: 1000 });
    await TestRenderer.act(async () => { tap(r, 'Bathroom').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Workshop').props.onPress(); });
    expect(r.queryByText('Evenly')).not.toBeNull();
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave.mock.calls[0][1]).toEqual({ ids: ['e1', 'e2', 'e3'], amounts: [333.34, 333.33, 333.33] });
  });

  it('takes amounts, says what stays on the whole job, and refuses more than the bill', async () => {
    const { r, onSave } = await open(rooms, { amount: 1000 });
    await TestRenderer.act(async () => { tap(r, 'Bathroom').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'By amount').props.onPress(); });
    await TestRenderer.act(async () => {
      boxes(r)['Bathroom share'].props.onChangeText('600');
      boxes(r)['Laundry share'].props.onChangeText('300');
    });
    expect(r.queryByText('$100 stays on the whole job')).not.toBeNull();

    await TestRenderer.act(async () => { boxes(r)['Laundry share'].props.onChangeText('500'); });
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(r.getAllByText('The rooms add up to more than the bill.').length).toBeGreaterThan(0);

    await TestRenderer.act(async () => { boxes(r)['Laundry share'].props.onChangeText('400'); });
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave.mock.calls[0][1]).toEqual({ ids: ['e1', 'e2'], amounts: [600, 400] });
  });

  it('can record the rooms without splitting the money', async () => {
    const { r, onSave } = await open(rooms, { amount: 1000 });
    await TestRenderer.act(async () => { tap(r, 'Bathroom').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Don’t split').props.onPress(); });
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave.mock.calls[0][1]).toEqual({ ids: ['e1', 'e2'], amounts: null });
  });

  it('opens on the split already saved', async () => {
    const { r } = await open(rooms, { amount: 1000, roomIds: ['e1', 'e3'], roomAmounts: [700, 300] });
    expect(boxes(r)['Bathroom share'].props.value).toBe('700');
    expect(boxes(r)['Workshop share'].props.value).toBe('300');
  });

  it('refuses to split a bill with no figure', async () => {
    const { r, onSave } = await open(rooms, { amount: null });
    await TestRenderer.act(async () => { tap(r, 'Bathroom').props.onPress(); });
    await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(r.getAllByText('Put a figure on it before splitting it.').length).toBeGreaterThan(0);
  });
});

it('adds a room to the job from here, and ticks it', async () => {
  const onAddRoom = jest.fn().mockResolvedValue('e9');
  const { r, onSave } = await open([element('e1', 'Bathroom')], {}, onAddRoom);
  await TestRenderer.act(async () => { tap(r, 'Add a room…').props.onPress(); });
  await TestRenderer.act(async () => { boxes(r)['New room'].props.onChangeText('Storage'); });
  await TestRenderer.act(async () => { await tap(r, 'Add “Storage”').props.onPress(); });
  expect(onAddRoom).toHaveBeenCalledWith('Storage');
  await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
  expect(onSave.mock.calls[0][1].ids).toEqual(['e9']);
});

it('holds the sheet open over a date the calendar has not got', async () => {
  const { r, onSave, onClose } = await open();
  const due = r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Due' && 'onChangeText' in n.props, { deep: true })[0];
  await TestRenderer.act(async () => { due.props.onChangeText('31/02/2026'); });
  await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(r.queryByText('The due date isn’t a day the calendar has.')).not.toBeNull();
});

describe('what kind of paper it is', () => {
  it('asks, and saves the answer with the rest', async () => {
    const { r, onSave } = await open();
    expect(r.queryByText('What is it?')).not.toBeNull();
    await TestRenderer.act(async () => { tap(r, 'Quote').props.onPress(); });
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: 'quote', dueOn: null });
  });

  // Paperwork is filed on one level and counts towards nothing, so it is not
  // asked when it is due or how it splits between rooms.
  it('asks paperwork neither a due date nor rooms, and saves no split', async () => {
    const { r, onSave } = await open([element('e1', 'Bathroom')], { kind: 'paperwork', elementId: 'e1' });
    expect(r.queryByText('Check this paperwork')).not.toBeNull();
    expect(r.queryByText('Due')).toBeNull();
    expect(r.queryByText('Bathroom')).toBeNull();
    expect(boxes(r)['Number on it']).toBeDefined();
    await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paperwork' }), { ids: [], amounts: null });
  });
});
