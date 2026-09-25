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
  id: 'r1', projectId: 'p1', elementId: null, kind: 'invoice', addressedTo: null, sourcePart: 0,
  supplier: 'Tile Space', detail: null,
  amount: 2480, amountInclGst: true,
  invoiceNumber: 'TS-4471', dated: '2026-09-16', dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: null, sourceSubject: null, sourceFrom: null, sourceAt: null,
  inferred: [], state: 'pending', quoteId: null, decidedAt: null,
  photoPaths: [], documentPaths: [], roomIds: [], roomAmounts: null,
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

// An emailed bill brings the invoice with it, and the invoice is what every
// field on the card has to be checked against — so it is one tap away, named as
// the file was named rather than as a storage key.
it('lists what came with the email and opens it', () => {
  const onOpenFile = jest.fn();
  const { r } = arrange(
    { documentPaths: ['h1/docs/1790000000000-012345-INV-0208.pdf'], photoPaths: ['h1/1790000000000-1.jpg'] },
    { onOpenFile },
  );
  expect(r.queryByText('INV-0208.pdf')).not.toBeNull();
  expect(r.queryByText('Photo')).not.toBeNull();

  const open = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Open INV-0208.pdf' && n.props?.onPress)[0];
  TestRenderer.act(() => open.props.onPress());
  expect(onOpenFile).toHaveBeenCalledWith('h1/docs/1790000000000-012345-INV-0208.pdf');
});

it('lists nothing when nothing came with it', () => {
  const { r } = arrange({}, { onOpenFile: jest.fn() });
  expect(r.root.findAll((n: any) => /^Open /.test(n.props?.accessibilityLabel ?? '')).length).toBe(0);
});

// The figure is the field a guess costs most on. A GST basis the bill did not
// state is the reader's assumption, and the card says so beside the amount.
it('marks the figure as guessed when its GST basis was', () => {
  const { r } = arrange({ inferred: ['amount_incl_gst'] });
  expect(r.queryByText('guessed')).not.toBeNull();
});

it('marks a supplier taken from the sender rather than the bill', () => {
  const { r } = arrange({ inferred: ['supplier'] });
  expect(r.queryByText('supplier guessed')).not.toBeNull();
});

it('says where allocating puts it, before anybody presses Allocate', () => {
  const { r } = arrange({}, { landsOn: 'Bathroom, Laundry · split evenly' });
  expect(r.queryByText('For')).not.toBeNull();
  expect(r.queryByText('Bathroom, Laundry · split evenly')).not.toBeNull();
});

describe('a card that looks like a bill already on the job', () => {
  it('says which, offers to open it, and still allocates', () => {
    const onOpenDuplicate = jest.fn();
    const { r, onApprove } = arrange({}, {
      duplicate: 'Looks like TS-4471 from Tile Space ($2,480, 16 Sep 2026), already on the job',
      onOpenDuplicate,
    });
    r.getByText('Looks like TS-4471 from Tile Space ($2,480, 16 Sep 2026), already on the job');
    const open = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Open the bill it looks like' && n.props?.onPress)[0];
    TestRenderer.act(() => open.props.onPress());
    expect(onOpenDuplicate).toHaveBeenCalled();
    press(r, 'Allocate');
    expect(onApprove).toHaveBeenCalled();
  });

  it('says nothing when there is no likely twin', () => {
    const { r } = arrange();
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('Looks like');
  });
});

describe('one email, several kinds of paper', () => {
  const words = (r: ReturnType<typeof render>) =>
    r.getAllByType('Text').map((n) => n.children.join('')).join(' ');

  it('says what kind of paper every card is, and marks a guess', () => {
    expect(arrange().r.queryByText('Invoice')).not.toBeNull();
    const { r } = arrange({ kind: 'quote', inferred: ['kind'] });
    expect(r.queryByText('Quote')).not.toBeNull();
    expect(r.queryByText('guessed')).not.toBeNull();
  });

  // A quote allocated as a bill is how an unsigned $49,482.20 deck quote would
  // have landed in *To pay*.
  it('adds a quote as a quote, and never asks whether it was paid', () => {
    const { r, onApprove } = arrange({ kind: 'quote', invoiceNumber: 'QU-0111' });
    expect(r.queryByText('Allocate')).toBeNull();
    press(r, 'Add quote');
    expect(onApprove).toHaveBeenCalled();
    expect(words(r)).not.toContain('paid');
  });

  it('files paperwork — never allocates it — and calls it by what it is', () => {
    const { r, onApprove } = arrange({
      kind: 'paperwork', supplier: 'Good Connection', detail: 'Certificate of compliance',
      amount: null, invoiceNumber: null,
    });
    expect(r.queryByText('Good Connection · Certificate of compliance')).not.toBeNull();
    expect(r.queryByText('Allocate')).toBeNull();
    // A certificate is not an unpriced bill.
    expect(r.queryByText('Not priced')).toBeNull();
    expect(words(r)).not.toContain('paid');
    press(r, 'File it');
    expect(onApprove).toHaveBeenCalled();
  });

  it('says why somebody else’s bill is paperwork, and keeps its figure for reference', () => {
    const { r } = arrange({
      kind: 'paperwork', supplier: 'Force Plumbing', addressedTo: 'ReliaBuilder', amount: 1200,
    });
    expect(r.queryByText('Made out to ReliaBuilder, not you — kept as paperwork so it isn’t counted twice')).not.toBeNull();
    expect(r.queryByText('$1,200')).not.toBeNull();
  });
});

describe('reading again', () => {
  const blank = {
    supplier: null, detail: null, amount: null, invoiceNumber: null, dated: null, dueOn: null,
    sourceSubject: 'Fwd: Variations', documentPaths: ['h/docs/1790265108843-292946-Variations - INV 0184.pdf'],
    inferred: ['kind'],
  };

  it('is offered on a card nothing was read off, and calls back', () => {
    const onReread = jest.fn();
    const { r } = arrange(blank, { onReread });
    expect(r.queryByText('Nothing was read off this yet.')).not.toBeNull();
    // Its own file's name, not the subject every card from that email shares.
    expect(r.queryByText('Variations - INV 0184.pdf')).not.toBeNull();
    press(r, 'Read again');
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('is not offered once anything is on the card', () => {
    const { r } = arrange({ ...blank, supplier: 'ReliaBuilder' }, { onReread: jest.fn() });
    expect(r.queryByText('Read again')).toBeNull();
  });

  it('holds the card while the reading is out', () => {
    const { r } = arrange(blank, { onReread: jest.fn(), rereading: true });
    const allocate = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.label === 'Allocate', { deep: true },
    )[0];
    expect(allocate.props.disabled).toBe(true);
  });
});

/*
 * What the paper is, said on the card and changed from there. The reader only
 * guessed; the person holding the paper knows, and should not have to find the
 * pencil to say so.
 */
describe('the kind pill', () => {
  const pill = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll((n: any) => n.props?.accessibilityLabel === label && !!n.props?.onPress, { deep: true })[0];

  it('is a label, not a control, when nothing can change it', () => {
    // Twice: the pill, and the label on the invoice number.
    const { r } = arrange();
    expect(r.getAllByText('Invoice')).toHaveLength(2);
    expect(pill(r, 'Invoice. Change what it is')).toBeUndefined();
  });

  it('opens the three answers, each saying what it does to the money', () => {
    const { r } = arrange({}, { onChangeKind: jest.fn().mockResolvedValue(undefined) });
    TestRenderer.act(() => pill(r, 'Invoice. Change what it is').props.onPress());
    r.getByText('Allocated to the job as something to pay');
    r.getByText('Added as a price nobody has agreed to yet');
    r.getByText('Filed on the job — it counts towards no figure');
  });

  it('writes the kind chosen, and says when the kind was a guess', async () => {
    const onChangeKind = jest.fn().mockResolvedValue(undefined);
    const { r } = arrange({ inferred: ['kind'] }, { onChangeKind });
    const open = pill(r, 'Invoice, guessed. Change what it is');
    TestRenderer.act(() => open.props.onPress());
    await TestRenderer.act(async () => { pill(r, 'Paperwork').props.onPress(); });
    expect(onChangeKind).toHaveBeenCalledWith('paperwork');
  });

  it('writes nothing when the kind it already is is chosen', async () => {
    const onChangeKind = jest.fn().mockResolvedValue(undefined);
    const { r } = arrange({ kind: 'quote' }, { onChangeKind });
    TestRenderer.act(() => pill(r, 'Quote. Change what it is').props.onPress());
    await TestRenderer.act(async () => { pill(r, 'Quote').props.onPress(); });
    expect(onChangeKind).not.toHaveBeenCalled();
  });

  it('stops offering the change while the card is being ruled on', () => {
    const { r } = arrange({}, { onChangeKind: jest.fn(), busy: true });
    expect(pill(r, 'Invoice. Change what it is')).toBeUndefined();
  });
});

describe('a bill for money that was earmarked', () => {
  const earmark = (over: any = {}): any => ({
    id: 'x1', projectId: 'p1', elementId: null, name: 'ReliaBuilder payment 3/4',
    amount: 43987.5, amountInclGst: true, likelySupplier: null, note: null,
    confirmed: false, settledBy: null, createdAt: '2026-09-24T09:33:57Z', ...over,
  });
  const match = (over: any = {}) => ({ expected: earmark(over), strength: 'strong' as const, difference: 0 });

  it('offers the earmark ticked, and allocating sends it', () => {
    const { r, onApprove } = arrange({}, { paysOff: [match()] });
    r.getByText('Pays off ReliaBuilder payment 3/4 · $43,987.50');
    r.getByText('Takes it off Expected to pay');
    press(r, 'Allocate');
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' }));
  });

  it('allocates on its own once the tick is taken off', () => {
    const { r, onApprove } = arrange({}, { paysOff: [match()] });
    const tick = r.root.findAll(
      (n: any) => n.props?.accessibilityRole === 'checkbox' && n.props?.onPress, { deep: true },
    )[0];
    TestRenderer.act(() => tick.props.onPress());
    r.getByText('Stays on Expected to pay');
    press(r, 'Allocate');
    expect(onApprove).toHaveBeenCalledWith(null);
  });

  it('says nothing when nothing matches', () => {
    const { r, onApprove } = arrange();
    expect(r.queryByText('Takes it off Expected to pay')).toBeNull();
    press(r, 'Allocate');
    expect(onApprove).toHaveBeenCalledWith(null);
  });
});
