import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import InvoiceReviewCard from './InvoiceReviewCard';
import type { InvoiceReview } from '../types';

/**
 * The card that takes a yes or a no on a bill nobody has recorded yet.
 *
 * What these pin is the honesty rather than the layout: a card that presents
 * its guesses in the same voice as its readings is a card somebody approves
 * eleven of and regrets one, and a bill nobody priced must never render as a
 * bill for nothing.
 */

const review = (over: Partial<InvoiceReview> = {}): InvoiceReview => ({
  id: 'r1', projectId: 'p1', elementId: null,
  supplier: 'Tile Space', detail: null,
  amount: 2480, amountInclGst: true,
  invoiceNumber: 'TS-4471', dated: '2026-09-16', dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: null, sourceSubject: null, sourceFrom: null, sourceAt: null,
  inferred: [], state: 'pending', quoteId: null, decidedAt: null,
  createdAt: '2026-09-16T00:00:00Z',
  ...over,
});

function arrange(over: Partial<InvoiceReview> = {}, props: Partial<React.ComponentProps<typeof InvoiceReviewCard>> = {}) {
  const onApprove = jest.fn();
  const onDecline = jest.fn();
  const r = render(
    <InvoiceReviewCard
      review={review(over)}
      onApprove={onApprove}
      onDecline={onDecline}
      {...props}
    />
  );
  return { r, onApprove, onDecline };
}

/** The `Button` carrying that word, found by its own prop rather than a label. */
const press = (r: ReturnType<typeof render>, label: string) => {
  const node = r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.label === label && !!n.props?.onPress,
    { deep: true }
  )[0];
  TestRenderer.act(() => node.props.onPress());
};

// `PhotoViewer`'s rule, one screen over: half the people who open this are in a
// desktop browser with a mouse and no second finger, and a card whose only way
// to answer is a gesture that device cannot make is a card that does nothing.
it('offers buttons as well as a swipe, because half its readers cannot swipe', () => {
  const { r, onApprove, onDecline } = arrange();

  expect(r.queryByText('Allocate')).not.toBeNull();
  expect(r.queryByText('Remove')).not.toBeNull();

  press(r, 'Allocate');
  expect(onApprove).toHaveBeenCalledTimes(1);

  press(r, 'Remove');
  expect(onDecline).toHaveBeenCalledTimes(1);
});

it('leads with the supplier and the invoice number', () => {
  const { r } = arrange();
  expect(r.queryByText('Tile Space · TS-4471')).not.toBeNull();
});

// The rule every figure in this app follows. An invoice whose amount could not
// be read is not an invoice for nought, and rendering $0.00 would put a
// confident falsehood where the answer should be.
it('says a bill nobody could price is not priced, never zero', () => {
  const { r } = arrange({ amount: null });
  expect(r.queryByText('Not priced')).not.toBeNull();
  expect(r.queryByText('$0.00')).toBeNull();
});

it('says when a figure was written ex-GST, because the difference is fifteen percent', () => {
  const { r } = arrange({ amount: 1000, amountInclGst: false });
  expect(r.queryByText('$1,000 + GST')).not.toBeNull();
});

// The load-bearing one. `inferred` is what keeps the app's answers and the
// invoice's answers in different voices.
it('marks a guessed field as a guess', () => {
  const { r } = arrange({ category: 'Tiling', inferred: ['category', 'invoice_number'] });

  // One "guessed" mark per guessed field, and none for the fields that were read.
  expect(r.getAllByText('guessed')).toHaveLength(2);
});

it('marks nothing on a card that was read straight off the invoice', () => {
  const { r } = arrange({ category: 'Tiling' });
  expect(r.queryByText('guessed')).toBeNull();
});

// Never the flag alone: the sentence is what a reader can disagree with.
it('shows the words the paid answer was drawn from', () => {
  const { r } = arrange({
    paid: true,
    paidEvidence: 'Alyssa wrote “I’ve just paid the quote” on 16 Sep',
  });
  expect(r.queryByText('Paid — Alyssa wrote “I’ve just paid the quote” on 16 Sep')).not.toBeNull();
});

it('states the unpaid answer rather than leaving it as the absence of a tick', () => {
  const { r } = arrange({ paid: false });
  expect(r.queryByText('Nothing in the thread says it was paid')).not.toBeNull();
});

it('says where it came from, so a card can be checked against the email', () => {
  const { r } = arrange({ sourceFrom: 'marcusn@tiles.co.nz' });
  expect(r.queryByText('from marcusn@tiles.co.nz')).not.toBeNull();
});
