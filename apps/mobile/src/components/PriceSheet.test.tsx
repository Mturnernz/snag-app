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
      onOpenBuildUp={jest.fn()}
      onOpenSchedule={jest.fn()}
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
  it('says what it is and when it is due, on the first of the month too', () => {
    const { r } = open();
    r.getByText('$4,200');
    r.getByText('Due 1 Oct 2026');
  });

  it('is paid in one press, for exactly what is owing, dated today', async () => {
    const { r, onChanged } = open();
    await press(r, 'Mark as paid, $4,200');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 4200, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(onChanged).toHaveBeenCalledWith('Paid');
  });

  it('takes a part payment as a payment, never as a flag', async () => {
    const { r } = open();
    await press(r, 'Record a part payment');
    await TestRenderer.act(async () => { node(r, 'Amount paid', 'onChangeText').props.onChangeText('2000'); });
    await press(r, 'Save payment');
    expect(mock_addPayment).toHaveBeenCalledWith('b1', expect.objectContaining({ amount: 2000 }));
    expect(mock_payBill).not.toHaveBeenCalled();
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
    r.getByText('$46,000');
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
