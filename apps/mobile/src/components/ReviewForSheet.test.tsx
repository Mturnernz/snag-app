import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ReviewForSheet from './ReviewForSheet';
import { quote } from '../test/projectFixtures';
import type { InvoiceReview } from '../types';

/**
 * *What's it for?* — the dropdown behind a waiting card's For line. One list:
 * the quotes a bill can be a stage of, then the areas it can go on with none.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const review = (over: Partial<InvoiceReview> = {}): InvoiceReview => ({
  id: 'r1', projectId: 'p1', elementId: null, kind: 'invoice', addressedTo: null, sourcePart: 0,
  supplier: 'RELIABUILDER LIMITED', detail: 'Deck — final payment 5%', amount: 2474.11, amountInclGst: true,
  invoiceNumber: 'INV-0190', dated: null, dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, alreadyPaid: null, againstQuoteId: null, claimDecided: false, category: null,
  sourceRef: null, sourceSubject: null, sourceFrom: null, sourceAt: null,
  inferred: [], state: 'pending', quoteId: null, decidedAt: null,
  photoPaths: [], documentPaths: [], roomIds: [], roomAmounts: null,
  createdAt: '2026-10-29T00:00:00Z',
  ...over,
});

const deck = quote({ id: 'c1', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'QU-0111', detail: 'Deck and sub structure replacement', amount: 49482.2, status: 'accepted' });
const trees = quote({ id: 't1', projectId: 'p1', supplier: 'Shore Tree Services', invoiceNumber: 'QU-4068', detail: 'Reduce the griselinia', amount: 1092.5 });
const declined = quote({ id: 'x1', projectId: 'p1', supplier: 'Other Builders', detail: 'Too dear', amount: 60000, status: 'declined' });
const bill = quote({ id: 'b1', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', kind: 'invoice', detail: 'Variations', amount: 5587.85 });
const area = (id: string, name: string) => ({ id, name, room: name, implicit: false } as any);
const elements = [area('e1', 'Roof'), area('e2', 'Deck')];

function open(over: Partial<React.ComponentProps<typeof ReviewForSheet>> = {}) {
  const onPick = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <ReviewForSheet
      visible
      review={review()}
      quotes={[trees, deck, declined, bill]}
      elements={elements}
      current={deck}
      suggested={deck}
      suggestedAreas={[]}
      onPick={onPick}
      onClose={onClose}
      {...over}
    />
  );
  return { r, onPick, onClose };
}
const press = async (r: ReturnType<typeof render>, label: string) => {
  const node = r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.onPress, { deep: true })[0];
  await TestRenderer.act(async () => { node.props.onPress(); });
};

it('offers the quotes not turned down, the bill’s own business first, then the areas', () => {
  const { r } = open();
  r.getByText('Part of a quote');
  r.getByText('QU-0111 · Deck and sub structure replacement');
  r.getByText('RELIABUILDER LIMITED · $49,482.20 · agreed · its words say so');
  r.getByText('QU-4068 · Reduce the griselinia');
  expect(r.queryByText('Too dear')).toBeNull();
  expect(r.queryByText('Variations')).toBeNull();
  r.getByText('On its own');
  r.getByText('Whole job');
  r.getByText('Deck');
  const titles = [...new Set(r.root.findAll((n: any) => n.props?.accessibilityRole === 'radio', { deep: true })
    .map((n: any) => n.props.accessibilityLabel as string))];
  expect(titles.slice(0, 2)).toEqual(['QU-0111 · Deck and sub structure replacement', 'QU-4068 · Reduce the griselinia']);
});

it('writes a quote, or an area with no quote, in one press and closes', async () => {
  const a = open();
  await press(a.r, 'QU-4068 · Reduce the griselinia');
  expect(a.onPick).toHaveBeenCalledWith({ quoteId: 't1' });
  expect(a.onClose).toHaveBeenCalled();

  const b = open();
  await press(b.r, 'Deck');
  expect(b.onPick).toHaveBeenCalledWith({ elementId: 'e2' });
  const c = open();
  await press(c.r, 'Whole job');
  expect(c.onPick).toHaveBeenCalledWith({ elementId: null });
});

it('writes nothing for the answer it already has', async () => {
  const { r, onPick, onClose } = open();
  await press(r, 'QU-0111 · Deck and sub structure replacement');
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('marks the area its words name, and offers a quote card only areas', () => {
  const { r } = open({ review: review({ kind: 'quote' }), current: null, suggested: null, suggestedAreas: ['e2'] });
  expect(r.queryByText('Part of a quote')).toBeNull();
  r.getByText('Where it goes');
  r.getByText('its words name it');
});

it('says a refusal in words and stays open', async () => {
  const onPick = jest.fn().mockRejectedValue(new Error('That quote was turned down'));
  const { r, onClose } = open({ onPick });
  await press(r, 'Deck');
  r.getByText('That quote was turned down');
  expect(onClose).not.toHaveBeenCalled();
});
