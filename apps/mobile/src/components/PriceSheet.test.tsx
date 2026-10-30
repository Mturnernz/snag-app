import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import PriceSheet from './PriceSheet';
import { quote } from '../test/projectFixtures';

/**
 * One bill, or one agreed price. Every bill opens here — the old page had no
 * way to pay, correct or delete a bill that was not on an item.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const mock_payBill = jest.fn().mockResolvedValue(undefined);
const mock_addPayment = jest.fn().mockResolvedValue({});
const mock_deleteQuote = jest.fn().mockResolvedValue(['h/docs/inv.pdf']);
const mock_deleteStoredFiles = jest.fn().mockResolvedValue(undefined);
const mock_updateQuote = jest.fn().mockResolvedValue(undefined);
const mock_setQuoteStatus = jest.fn().mockResolvedValue(undefined);
const mock_setQuoteRooms = jest.fn().mockResolvedValue([]);
const mock_setQuoteKind = jest.fn().mockResolvedValue(undefined);
const mock_updateExpectedCost = jest.fn().mockResolvedValue(undefined);
const mock_setQuoteClaim = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    payBill: (...a: unknown[]) => mock_payBill(...a),
    addPayment: (...a: unknown[]) => mock_addPayment(...a),
    deletePayment: jest.fn(),
    deleteQuote: (...a: unknown[]) => mock_deleteQuote(...a),
    deleteStoredFiles: (...a: unknown[]) => mock_deleteStoredFiles(...a),
    updateQuote: (...a: unknown[]) => mock_updateQuote(...a),
    setQuoteStatus: (...a: unknown[]) => mock_setQuoteStatus(...a),
    setQuoteKind: (...a: unknown[]) => mock_setQuoteKind(...a),
    setQuoteRooms: (...a: unknown[]) => mock_setQuoteRooms(...a),
    setFileTags: jest.fn().mockResolvedValue(undefined),
    updateExpectedCost: (...a: unknown[]) => mock_updateExpectedCost(...a),
    setQuoteClaim: (...a: unknown[]) => mock_setQuoteClaim(...a),
    formatMoney: real.formatMoney,
  };
});

beforeEach(() => jest.clearAllMocks());

const bill = quote({
  id: 'b1', projectId: 'p1', supplier: 'Studio North', detail: 'Design fees', amount: 4200,
  kind: 'invoice', status: 'accepted', unpaid: 4200, dueOn: '2026-10-01',
});

function open(q: any = bill, extra: Partial<React.ComponentProps<typeof PriceSheet>> = {}) {
  const onChanged = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <PriceSheet
      visible
      quote={q}
      householdId="h"
      quotes={[q]}
      payments={[]}
      lines={[]}
      onClose={onClose}
      onChanged={onChanged}
      onOpen={jest.fn()}
      elements={[]}
      locations={[]}
      quoteRooms={[]}
      onAddRoom={jest.fn().mockResolvedValue(null)}
      {...extra}
    />
  );
  return { r, onChanged, onClose };
}

const node = (r: ReturnType<typeof render>, label: string, prop = 'onPress') => {
  const found = r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.[prop], { deep: true });
  if (!found.length) throw new Error(`Nothing labelled "${label}"`);
  return found[found.length - 1];
};
const press = async (r: ReturnType<typeof render>, label: string) => {
  await TestRenderer.act(async () => { node(r, label).props.onPress(); });
};

describe('a bill', () => {
  // Today is pinned to September 2026: the dates in this test were written then,
  // and a real clock walks past them. Only Date is faked; timers run as normal.
  beforeEach(() => jest.useFakeTimers({
    now: new Date(2026, 8, 20, 12),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'],
  }));
  afterEach(() => jest.useRealTimers());

  it('says what it is and when it is due, on the first of the month too', () => {
    const { r } = open();
    r.getByText('$4,200');
    r.getByText('Due 1 Oct 2026');
  });

  it('is paid in one press, for exactly what is owing, dated today', async () => {
    const { r, onChanged } = open();
    await press(r, 'Mark as paid, $4,200');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 4200, '2026-09-20');
    expect(onChanged).toHaveBeenCalledWith('Paid');
  });

  it('asks when a bill that fell due before today was paid, offering its due date first', async () => {
    // Fourteen bills on the live job were marked paid on the day of a tidy-up,
    // months after they went out: the payment's date was the press, not the bank.
    const { r, onChanged } = open({ ...bill, dated: '2026-08-28', dueOn: '2026-09-05' });
    await press(r, 'Mark as paid, $4,200');
    expect(mock_payBill).not.toHaveBeenCalled();
    r.getByText('When was it paid?');
    r.getByText('On its due date');
    r.getByText('On the bill’s date');
    await press(r, 'Save');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 4200, '2026-09-05');
    expect(onChanged).toHaveBeenCalledWith('Paid · 5 Sep 2026');
  });

  it('opened from a Paid press, asks at once and goes back to the page either way', async () => {
    const past = { ...bill, dated: '2026-08-28', dueOn: '2026-09-05' };
    const cancelled = open(past, { askWhenPaid: true });
    cancelled.r.getByText('When was it paid?');
    await press(cancelled.r, 'Cancel');
    expect(cancelled.onClose).toHaveBeenCalled();
    expect(mock_payBill).not.toHaveBeenCalled();

    const saved = open(past, { askWhenPaid: true });
    await press(saved.r, 'Save');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 4200, '2026-09-05');
    expect(saved.onClose).toHaveBeenCalled();
  });

  it('takes another day, and refuses one the calendar has not got', async () => {
    const { r, onChanged } = open({ ...bill, dated: '2026-08-28', dueOn: '2026-09-05' });
    await press(r, 'Mark as paid, $4,200');
    await press(r, 'Another day');
    await TestRenderer.act(async () => { node(r, 'Paid on', 'onChangeText').props.onChangeText('31/02/2026'); });
    await press(r, 'Save');
    expect(mock_payBill).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith('That date isn’t one a calendar has');
    await TestRenderer.act(async () => { node(r, 'Paid on', 'onChangeText').props.onChangeText('2/9/2026'); });
    await press(r, 'Save');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 4200, '2026-09-02');
  });

  it('takes a part payment as a payment, never as a flag', async () => {
    const { r } = open();
    await press(r, 'Record a part payment');
    await TestRenderer.act(async () => { node(r, 'Amount paid', 'onChangeText').props.onChangeText('2000'); });
    await press(r, 'Save payment');
    expect(mock_addPayment).toHaveBeenCalledWith('b1', expect.objectContaining({ amount: 2000, paidOn: '2026-09-20' }));
    expect(mock_payBill).not.toHaveBeenCalled();
  });

  it('dates a part payment on the day it is given', async () => {
    const { r } = open();
    await press(r, 'Record a part payment');
    await TestRenderer.act(async () => { node(r, 'Amount paid', 'onChangeText').props.onChangeText('2000'); });
    await TestRenderer.act(async () => { node(r, 'Paid on', 'onChangeText').props.onChangeText('3/9/2026'); });
    await press(r, 'Save payment');
    expect(mock_addPayment).toHaveBeenCalledWith('b1', expect.objectContaining({ amount: 2000, paidOn: '2026-09-03' }));
  });

  it('says when its own words call it a quote, and makes it one in a press', async () => {
    const { r } = open({ ...bill, supplier: 'Regency Plumbing', detail: 'Customer Quotation No. 33737' });
    r.getByText('Its own words call it a quote');
    await press(r, 'Make it a quote');
    expect(mock_setQuoteKind).toHaveBeenCalledWith('b1', 'quote');
  });

  it('says nothing about quote words on a bill already paid against', () => {
    const paid = { id: 'p', quoteId: 'b1', amount: 100, amountInclGst: true, paidOn: '2026-09-01', reference: null, notes: null, photoPaths: [], documentPaths: [], createdAt: '' };
    const { r } = open({ ...bill, detail: 'Customer Quotation No. 33737' }, { payments: [paid] });
    expect(r.queryByText('Its own words call it a quote')).toBeNull();
  });

  it('can be corrected', async () => {
    const { r } = open();
    await press(r, 'Edit');
    await TestRenderer.act(async () => { node(r, 'Amount', 'onChangeText').props.onChangeText('4400'); });
    await press(r, 'Save');
    expect(mock_updateQuote).toHaveBeenCalledWith('b1', expect.objectContaining({ amount: 4400, dueOn: '2026-10-01' }));
  });

  it('shows its invoice number, and a correction can change or empty it', async () => {
    const { r } = open({ ...bill, invoiceNumber: 'INV87022' });
    r.getByText('INV87022');
    await press(r, 'Edit');
    await TestRenderer.act(async () => { node(r, 'Invoice number', 'onChangeText').props.onChangeText('INV87023'); });
    await press(r, 'Save');
    expect(mock_updateQuote).toHaveBeenCalledWith('b1', expect.objectContaining({ invoiceNumber: 'INV87023' }));
    await press(r, 'Edit');
    await TestRenderer.act(async () => { node(r, 'Invoice number', 'onChangeText').props.onChangeText(' '); });
    await press(r, 'Save');
    expect(mock_updateQuote).toHaveBeenLastCalledWith('b1', expect.objectContaining({ invoiceNumber: null }));
  });

  it('can be deleted, and its files go with it', async () => {
    const { r, onClose } = open();
    await press(r, 'Delete invoice');
    // The confirmation's button is the shared `Button`, found by its label prop.
    const confirm = r.root.findAll((n: any) => n.props?.label === 'Delete' && n.props?.onPress, { deep: true });
    await TestRenderer.act(async () => { confirm[0].props.onPress(); });
    expect(mock_deleteQuote).toHaveBeenCalledWith('b1');
    expect(mock_deleteStoredFiles).toHaveBeenCalledWith(['h/docs/inv.pdf']);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers nothing to pay once it is paid', () => {
    const { r } = open({ ...bill, unpaid: 0 });
    r.getByText('Paid');
    expect(r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Mark as paid, $0', { deep: true })).toHaveLength(0);
  });
});

describe('an agreed price', () => {
  const contract = quote({
    id: 'c1', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'Building contract',
    amount: 185000, status: 'accepted', claimedTotal: 46000,
  });

  it('says what has been billed against it and what is left', () => {
    const { r } = open(contract);
    r.getByText('$46,000 · 25%');
    r.getByText('$139,000');
  });

  it('lists the progress bills that are part of it', () => {
    const claim = quote({ id: 'k1', supplier: 'ReliaBuilder', detail: 'Progress bill 1', kind: 'invoice', againstQuoteId: 'c1', amount: 46000, unpaid: 0 });
    const { r } = open(contract, { quotes: [contract, claim] });
    r.getByText('Progress bills');
    r.getByText('Progress bill 1');
  });

  it('can be turned down', async () => {
    const { r } = open(contract);
    await press(r, 'Turned down');
    expect(mock_setQuoteStatus).toHaveBeenCalledWith('c1', 'declined');
  });
});

describe('which rooms it is for', () => {
  const rooms = [
    { id: 'eB', projectId: 'p1', name: 'Bathroom', room: 'Bathroom', implicit: false },
    { id: 'eL', projectId: 'p1', name: 'Laundry', room: 'Laundry', implicit: false },
  ] as any[];

  it('shares a bill on the whole job evenly between the rooms ticked, in one write', async () => {
    const { r } = open(bill, { elements: rooms });
    r.getByText('Whole job');
    await press(r, 'Rooms');
    await press(r, 'Bathroom');
    await press(r, 'Laundry');
    await press(r, 'Save');
    expect(mock_setQuoteRooms).toHaveBeenCalledWith('b1', ['eB', 'eL'], [2100, 2100]);
    expect(mock_updateQuote).not.toHaveBeenCalled();
  });

  it('says how it is shared, and can be put back on the whole job', async () => {
    const { r } = open(bill, {
      elements: rooms,
      quoteRooms: [
        { quoteId: 'b1', elementId: 'eB', amount: 3000, sortOrder: 0 },
        { quoteId: 'b1', elementId: 'eL', amount: 1200, sortOrder: 1 },
      ],
    });
    r.getByText('Bathroom, Laundry · split by amount');
    await press(r, 'Rooms');
    await press(r, 'Bathroom');
    await press(r, 'Laundry');
    await press(r, 'Save');
    expect(mock_setQuoteRooms).toHaveBeenCalledWith('b1', [], null);
  });

  it('names the one room a price on a room is in, and offers no sharing', () => {
    const { r } = open(quote({ ...bill, id: 'b2', projectId: null, elementId: 'eB' }), { elements: rooms });
    r.getByText('Bathroom');
    expect(r.queryByText('Rooms')).toBeNull();
  });

  it('offers no sharing on a claim — its contract is what gets shared', () => {
    const { r } = open(quote({ ...bill, id: 'b3', againstQuoteId: 'c1' }), { elements: rooms });
    expect(r.queryByText('Rooms')).toBeNull();
  });
});

// A subcontractor's invoice made out to the builder is already inside the
// builder's invoice. Recorded as its own bill, the same money counts twice.
describe('a bill inside another bill', () => {
  const builder = quote({
    id: 'rb', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', detail: 'Variations', invoiceNumber: 'INV-0184',
    amount: 5587.85, kind: 'invoice', status: 'tbc', unpaid: 5587.85,
  });
  const plumber = quote({
    id: 'fp', projectId: 'p1', supplier: 'Force Plumbing', detail: 'Pipes relocation', invoiceNumber: 'INV-04621',
    amount: 1138.71, kind: 'invoice', status: 'tbc', unpaid: 1138.71,
  });
  const inside = { ...plumber, billedThroughId: 'rb' };

  it('asks, and says a bill of its own is one you pay', () => {
    const { r } = open(plumber, { quotes: [builder, plumber] });
    expect(r.queryByText('Part of another bill?')).not.toBeNull();
    expect(r.queryByText('No — we pay this one')).not.toBeNull();
  });

  it('is put inside the bill chosen, through the one link the totals already read', async () => {
    const { r, onChanged } = open(plumber, { quotes: [builder, plumber] });
    await TestRenderer.act(async () => { node(r, 'Part of another bill?').props.onPress(); });
    await TestRenderer.act(async () => { node(r, 'RELIABUILDER LIMITED · INV-0184').props.onPress(); });
    expect(mock_updateQuote).toHaveBeenCalledWith('fp', { billedThroughId: 'rb' });
    expect(onChanged).toHaveBeenCalledWith('Counted inside that bill');
  });

  it('says which bill it is inside, and offers nothing to pay', () => {
    const { r } = open(inside, { quotes: [builder, inside] });
    expect(r.queryByText('Inside another bill')).not.toBeNull();
    expect(r.queryByText('Inside RELIABUILDER LIMITED · INV-0184 — not counted on its own')).not.toBeNull();
    expect(r.queryByText('Mark as paid')).toBeNull();
  });

  it('can be counted on its own again', async () => {
    const { r } = open(inside, { quotes: [builder, inside] });
    await TestRenderer.act(async () => { node(r, 'Part of another bill?').props.onPress(); });
    await TestRenderer.act(async () => { node(r, 'No — we pay this one').props.onPress(); });
    expect(mock_updateQuote).toHaveBeenCalledWith('fp', { billedThroughId: null });
  });

  it('lets the bill it is inside say what it includes, and what is the builder\'s own', () => {
    const { r } = open(builder, { quotes: [builder, inside] });
    expect(r.queryByText('Includes')).not.toBeNull();
    expect(r.queryByText('Force Plumbing')).not.toBeNull();
    expect(r.queryByText('The rest of this bill')).not.toBeNull();
    expect(r.queryByText('$4,449.14')).not.toBeNull();
    // A bill holding others is not itself put inside something.
    expect(r.queryByText('Part of another bill?')).toBeNull();
  });

  it('is not offered on a progress claim, which counts through its contract already', () => {
    const claim = { ...plumber, againstQuoteId: 'rb' };
    const { r } = open(claim, { quotes: [builder, claim] });
    expect(r.queryByText('Part of another bill?')).toBeNull();
  });

  it('is not offered when there is no other bill to be inside', () => {
    const { r } = open(plumber, { quotes: [plumber] });
    expect(r.queryByText('Part of another bill?')).toBeNull();
  });
});

/**
 * What it is, said above the figure and changed from there. The change is
 * `setQuoteKind`'s alone, and a refusal is said in the chooser, not as a toast
 * over a sheet that has closed.
 */
describe('what it is', () => {
  it('says Invoice on a bill and Quote on a quote, as a way to change it', () => {
    open().r.getByText('Invoice');
    const { r } = open(quote({ id: 'q1', projectId: 'p1', supplier: 'Deck Co', amount: 9000, kind: 'quote' }));
    node(r, 'Quote. Change what it is');
  });

  it('turns an invoice into a quote through setQuoteKind, never updateQuote', async () => {
    const { r, onChanged } = open();
    await press(r, 'Invoice. Change what it is');
    await press(r, 'Quote');
    expect(mock_setQuoteKind).toHaveBeenCalledWith('b1', 'quote');
    expect(mock_updateQuote).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledWith('Now a quote — not agreed yet');
  });

  it('writes nothing when the kind it already is is chosen', async () => {
    const { r } = open();
    await press(r, 'Invoice. Change what it is');
    await press(r, 'Invoice');
    expect(mock_setQuoteKind).not.toHaveBeenCalled();
  });

  it('offers no paperwork, which a waiting card can be and a price cannot', async () => {
    const { r } = open();
    await press(r, 'Invoice. Change what it is');
    expect(r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Paperwork', { deep: true })).toHaveLength(0);
  });

  it('says a refusal in the chooser and keeps it open', async () => {
    mock_setQuoteKind.mockRejectedValueOnce(
      new Error('A payment is recorded against it, and a quote can’t be paid — remove it first'),
    );
    const { r, onChanged } = open();
    await press(r, 'Invoice. Change what it is');
    await press(r, 'Quote');
    r.getByText('A payment is recorded against it, and a quote can’t be paid — remove it first');
    expect(onChanged).not.toHaveBeenCalled();
    node(r, 'Quote');
  });
});

describe('a bill that paid off an earmark', () => {
  const earmark = (over: any = {}): any => ({
    id: 'x1', projectId: 'p1', elementId: null, name: 'ReliaBuilder payment 3/4',
    amount: 43987.5, amountInclGst: true, likelySupplier: null, note: null,
    confirmed: false, settledBy: 'b1', createdAt: '2026-09-24T09:33:57Z', ...over,
  });

  it('says which, and Undo puts it back on Expected to pay', async () => {
    const { r, onChanged } = open(bill, { expected: [earmark()] });
    r.getByText('Pays off ReliaBuilder payment 3/4');
    r.getByText('$43,987.50 expected · off Expected to pay');
    await press(r, 'Put ReliaBuilder payment 3/4 back on Expected to pay');
    expect(mock_updateExpectedCost).toHaveBeenCalledWith('x1', { settledBy: null });
    expect(onChanged).toHaveBeenCalledWith('ReliaBuilder payment 3/4 is back on Expected to pay');
  });

  it('says nothing about an earmark another bill paid off', () => {
    const { r } = open(bill, { expected: [earmark({ settledBy: 'someone-else' })] });
    expect(r.queryByText('Pays off ReliaBuilder payment 3/4')).toBeNull();
  });
});

describe('a stage of an agreed price', () => {
  const deck = quote({
    id: 'c1', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'QU-0111',
    detail: 'Deck and sub structure replacement', amount: 49482.2, status: 'accepted',
  });
  const deposit = quote({
    id: 'k1', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', detail: 'Deposit Required 20%',
    kind: 'invoice', amount: 9896.44, unpaid: 0,
  });

  it('offers the contract a deposit’s words describe, and links it in a press', async () => {
    const { r, onChanged } = open(deposit, { quotes: [deck, deposit] });
    r.getByText('Its words say QU-0111, so it’s counted twice until linked');
    await press(r, 'Link to RELIABUILDER LIMITED · QU-0111');
    expect(mock_setQuoteClaim).toHaveBeenCalledWith('k1', 'c1');
    expect(onChanged).toHaveBeenCalledWith('A claim on RELIABUILDER LIMITED · QU-0111');
  });

  it('lets any quote at the bill’s scope be chosen, and the link be taken off', async () => {
    const variation = quote({ ...deposit, id: 'k2', detail: 'Variations' });
    const { r } = open(variation, { quotes: [deck, variation] });
    r.getByText('No — billed on its own');
    await press(r, 'A stage of an agreed price?');
    r.getByText('A stage of an agreed price?');
    await press(r, 'RELIABUILDER LIMITED · QU-0111');
    expect(mock_setQuoteClaim).toHaveBeenCalledWith('k2', 'c1');

    const linked = open({ ...variation, againstQuoteId: 'c1' }, { quotes: [deck, variation] });
    linked.r.getByText('RELIABUILDER LIMITED · QU-0111');
    await press(linked.r, 'A stage of an agreed price?');
    await press(linked.r, 'No — it’s billed on its own');
    expect(mock_setQuoteClaim).toHaveBeenLastCalledWith('k2', null);
  });

  it('says a claim on a price nobody has agreed still counts on its own', () => {
    const open_ = { ...deck, status: 'tbc' as const };
    const { r } = open({ ...deposit, againstQuoteId: 'c1' }, { quotes: [open_, deposit] });
    r.getByText('RELIABUILDER LIMITED · QU-0111 — not agreed yet, so this counts on its own');
  });

  it('keeps the chooser open over a refusal', async () => {
    mock_setQuoteClaim.mockRejectedValueOnce(new Error('A claim has to sit where its contract sits — move one of them first'));
    const variation = quote({ ...deposit, id: 'k2', detail: 'Variations' });
    const { r, onChanged } = open(variation, { quotes: [deck, variation] });
    await press(r, 'A stage of an agreed price?');
    await press(r, 'RELIABUILDER LIMITED · QU-0111');
    expect(onChanged).toHaveBeenCalledWith('A claim has to sit where its contract sits — move one of them first');
    r.getByText('A stage of');
  });

  it('is not asked of a quote, or of nothing to be a stage of', () => {
    expect(open(deck, { quotes: [deck] }).r.queryByText('A stage of an agreed price?')).toBeNull();
    expect(open(deposit, { quotes: [deposit] }).r.queryByText('A stage of an agreed price?')).toBeNull();
  });
});

describe('agreeing a price that holds an expected payment', () => {
  const contract = quote({ id: 'c1', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'QU-0115', amount: 176755, status: 'tbc' });
  const earmark = (over: any = {}): any => ({
    id: 'x2', projectId: 'p1', elementId: null, name: 'Reliabuilder payment 4/4',
    amount: 43987.5, amountInclGst: true, likelySupplier: null, note: null,
    confirmed: true, settledBy: null, createdAt: '2026-09-24T09:33:57Z', ...over,
  });

  it('asks whether the business’s expected payments are part of it, and settles them with it', async () => {
    const { r, onChanged } = open(contract, { expected: [earmark()] });
    await press(r, 'Agreed');
    expect(mock_setQuoteStatus).toHaveBeenCalledWith('c1', 'accepted');
    r.getByText('Is Reliabuilder payment 4/4 part of this price?');
    const yes = r.root.findAll((n: any) => n.props?.label === 'Yes, it’s included' && n.props?.onPress, { deep: true });
    await TestRenderer.act(async () => { yes[0].props.onPress(); });
    expect(mock_updateExpectedCost).toHaveBeenCalledWith('x2', { settledBy: 'c1' });
    expect(onChanged).toHaveBeenLastCalledWith('Reliabuilder payment 4/4 is part of this price');
  });

  it('leaves them alone on No, and asks nothing about another business’s', async () => {
    const { r } = open(contract, { expected: [earmark()] });
    await press(r, 'Agreed');
    const no = r.root.findAll((n: any) => n.props?.label === 'No, it’s extra' && n.props?.onPress, { deep: true });
    await TestRenderer.act(async () => { no[0].props.onPress(); });
    expect(mock_updateExpectedCost).not.toHaveBeenCalled();

    const other = open(contract, { expected: [earmark({ name: 'Architect fees', likelySupplier: 'Studio North' })] });
    await press(other.r, 'Agreed');
    expect(other.r.queryByText('Is Architect fees part of this price?')).toBeNull();
  });
});
