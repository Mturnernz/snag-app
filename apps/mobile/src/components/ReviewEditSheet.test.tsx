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
  id: 'r1', projectId: 'p1', elementId: null,
  supplier: 'Reliabuilder', detail: null, amount: 43987.5, amountInclGst: true,
  invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: 'em_1', sourceSubject: 'Fwd: Claim 2', sourceFrom: 'sam@example.com', sourceAt: null,
  inferred: ['supplier'], state: 'pending', quoteId: null, decidedAt: null,
  createdAt: '2026-09-20T00:00:00Z', photoPaths: [], documentPaths: ['h1/docs/1-2-INV.pdf'],
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

async function open(elements: ProjectElement[] = []) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(<ReviewEditSheet review={review} elements={elements} onSave={onSave} onClose={onClose} />);
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

it('writes a correction to the card, an emptied box as a clear, and the part chosen', async () => {
  const { r, onSave, onClose } = await open([element('e1', 'Bathroom'), element('e2', 'Laundry')]);
  await TestRenderer.act(async () => {
    boxes(r)['Who it’s from'].props.onChangeText('ReliaBuilder');
    boxes(r)['Invoice number'].props.onChangeText('');
  });
  await TestRenderer.act(async () => { tap(r, 'Laundry').props.onPress(); });
  await TestRenderer.act(async () => { await tap(r, 'Save').props.onPress(); });

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    supplier: 'ReliaBuilder', invoiceNumber: null, amount: 43987.5, amountInclGst: true,
    dated: '2026-09-20', dueOn: null, elementId: 'e2',
  }));
  expect(onClose).toHaveBeenCalled();
});

it('does not offer a part that nobody has seen', async () => {
  const { r } = await open([element('e1', 'Downstairs laundry', true)]);
  expect(r.queryByText('Which part of the job?')).toBeNull();
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
