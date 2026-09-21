import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ItemSheet from './ItemSheet';

/**
 * One item, one price — Quote/Invoiced as the header, and a correction form
 * reduced to three fields.
 *
 * The failure this is built against is specific: an edit box that does not
 * hand back exactly what was typed. The rollup normalises to GST-inclusive,
 * so an edit form that loaded the *normalised* figure would raise a trade
 * price by 15% every time somebody opened it to fix a typo in the supplier's
 * name.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));
jest.mock('./Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const item = (over: Partial<any> = {}): any => ({
  id: 'i1', elementId: 'e1', name: 'Shower mixer', status: 'considering', excluded: false,
  sortOrder: 0,
  notes: null, photoPaths: [], documentPaths: [], createdAt: '',
  quoteCount: 1, chosenAmount: null, quotedLow: null, quotedHigh: null, spent: null,
  ...over,
});

const quote = (over: Partial<any> = {}): any => ({
  id: 'q1', itemId: 'i1', elementId: null, projectId: null,
  supplier: 'Mico', detail: 'Methven Krome',
  amount: 1000, amountInclGst: false, kind: 'quote', status: 'tbc', basis: 'fixed',
  dated: '2026-08-28', notes: null, supersedesLineId: null,
  photoPaths: [], documentPaths: [], createdAt: '',
  amountIncl: 1150, lineCount: 0, linesTotal: null, buildUp: null, allowanceOpen: 0,
  effectiveAmount: 1150, paidTotal: null, unpaid: null,
  ...over,
});

const payment = (over: Partial<any> = {}): any => ({
  id: 'pay1', quoteId: 'q1', amount: 1150, amountInclGst: true,
  paidOn: null, reference: null, notes: null,
  photoPaths: [], documentPaths: [], createdAt: '',
  ...over,
});

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true }
  )[0];

const boxByLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onChangeText,
    { deep: true }
  )[0];

function arrange(quotes: any[] = [quote()], payments: any[] = []) {
  const onUpdateQuote = jest.fn().mockResolvedValue(undefined);
  const onSetQuoteStatus = jest.fn().mockResolvedValue(undefined);
  const onAddQuote = jest.fn().mockResolvedValue(undefined);
  const onAddPayment = jest.fn().mockResolvedValue(undefined);
  const onUpdatePayment = jest.fn().mockResolvedValue(undefined);
  const onDeletePayment = jest.fn().mockResolvedValue(undefined);
  const onUpdateItem = jest.fn().mockResolvedValue(undefined);
  const r = render(
    <ItemSheet
      visible
      householdId="h"
      item={item()}
      quotes={quotes}
      payments={payments}
      onClose={jest.fn()}
      onUpdateItem={onUpdateItem}
      onDeleteItem={jest.fn().mockResolvedValue(undefined)}
      onAddQuote={onAddQuote}
      onSetQuoteStatus={onSetQuoteStatus}
      onUpdateQuote={onUpdateQuote}
      onDeleteQuote={jest.fn().mockResolvedValue(undefined)}
      onUpdateQuoteFiles={jest.fn().mockResolvedValue(undefined)}
      onAddPayment={onAddPayment}
      onUpdatePayment={onUpdatePayment}
      onDeletePayment={onDeletePayment}
    />
  );
  return {
    r, onUpdateQuote, onSetQuoteStatus, onAddQuote,
    onAddPayment, onUpdatePayment, onDeletePayment, onUpdateItem,
  };
}

const openEdit = async (r: ReturnType<typeof render>) =>
  TestRenderer.act(async () => byLabel(r, 'Correct the Mico price').props.onPress());

it('offers a way to correct a price that is already saved', async () => {
  const { r } = arrange();
  expect(byLabel(r, 'Correct the Mico price')).toBeDefined();
});

it('loads the figure exactly as it was typed, not the GST-inclusive one', async () => {
  const { r } = arrange();
  await openEdit(r);
  // $1,000 excl GST rolls up as $1,150. Loading 1150 into the box and saving it
  // would raise a trade price by 15% every time somebody opened it to fix a
  // typo in the supplier's name.
  expect(boxByLabel(r, 'Amount').props.value).toBe('1000');
  expect(byLabel(r, 'Excludes GST').props.accessibilityState.selected).toBe(true);
});

it('loads the rest of the row back into the same form', async () => {
  const { r } = arrange();
  await openEdit(r);
  expect(boxByLabel(r, 'Who from').props.value).toBe('Mico');
  expect(boxByLabel(r, 'What exactly').props.value).toBe('Methven Krome');
});

it('shows only who from, what exactly and amount while editing — nothing else', async () => {
  const { r } = arrange();
  await openEdit(r);
  expect(boxByLabel(r, 'Who from')).toBeDefined();
  expect(boxByLabel(r, 'What exactly')).toBeDefined();
  expect(boxByLabel(r, 'Amount')).toBeDefined();
  // Kind and the date used to live in this form. Deciding what kind of paper
  // it is and whether it has been paid are the header's job now, not
  // something a half-finished edit can carry along.
  expect(boxByLabel(r, 'Dated')).toBeUndefined();
  expect(byLabel(r, 'Quote')).toBeUndefined();
  expect(byLabel(r, 'Invoiced')).toBeUndefined();
});

it('saves the correction through updateQuote, not as a new price, and never carries kind or a date', async () => {
  const { r, onUpdateQuote, onAddQuote } = arrange();
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('1080'));
  await TestRenderer.act(async () => byLabel(r, 'Save the correction').props.onPress());

  expect(onAddQuote).not.toHaveBeenCalled();
  expect(onUpdateQuote).toHaveBeenCalledWith('q1', {
    amount: 1080,
    amountInclGst: false,
    supplier: 'Mico',
    detail: 'Methven Krome',
  });
});

it('never carries the status through a correction', async () => {
  const { r, onUpdateQuote, onSetQuoteStatus } = arrange([quote({ status: 'accepted' })]);
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('1080'));
  await TestRenderer.act(async () => byLabel(r, 'Save the correction').props.onPress());

  // Accepting stays on onSetQuoteStatus, which is its own call precisely so the
  // sibling-clearing can never be skipped by a caller passing a status among
  // other fields. A correction is not a decision.
  expect(Object.keys(onUpdateQuote.mock.calls[0][1])).not.toContain('status');
  expect(onSetQuoteStatus).not.toHaveBeenCalled();
});

it('clears a field that is emptied rather than leaving the old value', async () => {
  const { r, onUpdateQuote } = arrange();
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Who from').props.onChangeText(''));
  await TestRenderer.act(async () => byLabel(r, 'Save the correction').props.onPress());
  // An emptied supplier is somebody saying they no longer know. Leaving the old
  // one there would be the box lying about what it holds.
  expect(onUpdateQuote.mock.calls[0][1].supplier).toBeNull();
});

it('can be left without saving anything', async () => {
  const { r, onUpdateQuote } = arrange();
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('9999'));
  await TestRenderer.act(async () => byLabel(r, 'Leave it as it was').props.onPress());
  expect(onUpdateQuote).not.toHaveBeenCalled();
  // And the form is gone, rather than the only escape being to close the whole
  // sheet and lose the item somebody was looking at.
  expect(boxByLabel(r, 'Amount')).toBeUndefined();
});

describe('the header: quote, then accepted/declined or paid/not paid', () => {
  it('offers Quote and Invoiced, and moving to Invoiced writes the kind', async () => {
    const { r, onUpdateQuote } = arrange([quote({ kind: 'quote' })]);
    expect(byLabel(r, 'Quote')).toBeDefined();
    expect(byLabel(r, 'Invoiced')).toBeDefined();
    await TestRenderer.act(async () => byLabel(r, 'Invoiced').props.onPress());
    expect(onUpdateQuote).toHaveBeenCalledWith('q1', { kind: 'invoice' });
  });

  it('offers accepted or declined while it is a quote, never a third "not decided" pill', async () => {
    const { r, onSetQuoteStatus } = arrange([quote({ kind: 'quote', status: 'tbc' })]);
    expect(byLabel(r, 'Accepted')).toBeDefined();
    expect(byLabel(r, 'Declined')).toBeDefined();
    expect(byLabel(r, 'TBC')).toBeUndefined();

    await TestRenderer.act(async () => byLabel(r, 'Declined').props.onPress());
    expect(onSetQuoteStatus).toHaveBeenCalledWith('q1', 'declined');
  });

  it('tapping the chosen one again clears it back to tbc', async () => {
    const { r, onSetQuoteStatus } = arrange([quote({ kind: 'quote', status: 'accepted' })]);
    await TestRenderer.act(async () => byLabel(r, 'Accepted').props.onPress());
    expect(onSetQuoteStatus).toHaveBeenCalledWith('q1', 'tbc');
  });

  it('says "Pending invoice" once a quote is accepted', async () => {
    const { r } = arrange([quote({ kind: 'quote', status: 'accepted' })]);
    expect(r.root.findAllByProps({ children: 'Pending invoice' }).length).toBeGreaterThan(0);
  });

  it('keeps a declined price on the record rather than dropping it', async () => {
    // What you were quoted and by whom is what makes the next renovation's
    // numbers credible. It leaves every total; it does not leave the page.
    const { r } = arrange([quote({ status: 'declined', supplier: 'Mico' })]);
    expect(byLabel(r, 'Correct the Mico price')).toBeDefined();
  });

  it('offers Paid and Not paid once it is invoiced, never accepted/declined', async () => {
    const { r } = arrange([quote({ kind: 'invoice', status: 'tbc', unpaid: 1150 })]);
    expect(byLabel(r, 'Paid')).toBeDefined();
    expect(byLabel(r, 'Not paid')).toBeDefined();
    expect(byLabel(r, 'Accepted')).toBeUndefined();
    expect(byLabel(r, 'Declined')).toBeUndefined();
  });

  it('marking Paid records a payment for exactly what is still owed', async () => {
    const q = quote({ kind: 'invoice', amount: 1150, amountInclGst: true, unpaid: 1150 });
    const { r, onAddPayment } = arrange([q]);
    await TestRenderer.act(async () => byLabel(r, 'Paid').props.onPress());
    expect(onAddPayment).toHaveBeenCalledWith('q1', { amount: 1150, amountInclGst: true });
  });

  it('marking Not paid removes a bare payment without asking', async () => {
    // What the one-tap Paid wrote is a figure and nothing else, so undoing it
    // throws nothing away and a confirm would be ceremony people learn to tap
    // through — which is how the gate stops working on the day it matters.
    const q = quote({ kind: 'invoice', amount: 1150, amountInclGst: true, unpaid: 0 });
    const { r, onDeletePayment } = arrange([q], [payment({ id: 'pay1', quoteId: 'q1' })]);
    expect(byLabel(r, 'Paid').props.accessibilityState.selected).toBe(true);
    await TestRenderer.act(async () => byLabel(r, 'Not paid').props.onPress());
    expect(onDeletePayment).toHaveBeenCalledWith('pay1');
  });

  it('asks before clearing a payment somebody typed', async () => {
    // An invoice number, a date and the bill itself do not come back. The same
    // distinction a part of the job already draws: a heading goes on a
    // two-button confirm, something holding work gets named first.
    const q = quote({ kind: 'invoice', amount: 1150, amountInclGst: true, unpaid: 0 });
    const { r, onDeletePayment } = arrange(
      [q],
      [payment({ id: 'pay1', quoteId: 'q1', reference: 'INV-0208', paidOn: '2026-09-04' })]
    );
    await TestRenderer.act(async () => byLabel(r, 'Not paid').props.onPress());
    expect(onDeletePayment).not.toHaveBeenCalled();
    r.getByText('Clear what has been paid?');
  });
});

describe('a bill paid in lots', () => {
  const invoice = (over: Partial<any> = {}) =>
    quote({ kind: 'invoice', amount: 15000, amountInclGst: true, unpaid: 15000, ...over });

  it('is offered a payment of its own, under the price', async () => {
    const { r } = arrange([invoice()]);
    expect(byLabel(r, 'Add a payment')).toBeDefined();
  });

  it('offers nothing to pay against a price nobody has been billed for', async () => {
    // `add_payment` refuses it in words, so offering the control would be
    // offering a write the server is going to turn down.
    const { r } = arrange([quote({ kind: 'quote' })]);
    expect(byLabel(r, 'Add a payment')).toBeUndefined();
  });

  it('records the value, the invoice number and the day it went out', async () => {
    const { r, onAddPayment } = arrange([invoice()]);
    await TestRenderer.act(async () => byLabel(r, 'Add a payment').props.onPress());
    await TestRenderer.act(async () => {
      boxByLabel(r, 'How much').props.onChangeText('3000');
      boxByLabel(r, 'Invoice number').props.onChangeText('INV-0208');
      boxByLabel(r, 'Date paid').props.onChangeText('4/9/2026');
    });
    await TestRenderer.act(async () => byLabel(r, 'Save the payment').props.onPress());
    expect(onAddPayment).toHaveBeenCalledWith('q1', expect.objectContaining({
      amount: 3000,
      reference: 'INV-0208',
      // Day-first, because this is a New Zealand app: the fourth of September.
      paidOn: '2026-09-04',
    }));
  });

  it('will not record a payment with no figure', async () => {
    const { r, onAddPayment } = arrange([invoice()]);
    await TestRenderer.act(async () => byLabel(r, 'Add a payment').props.onPress());
    await TestRenderer.act(async () => {
      boxByLabel(r, 'Invoice number').props.onChangeText('INV-0208');
    });
    await TestRenderer.act(async () => byLabel(r, 'Save the payment').props.onPress());
    expect(onAddPayment).not.toHaveBeenCalled();
  });

  it('says what is paid and what is still to go, from the rows themselves', async () => {
    const { r } = arrange(
      [invoice({ unpaid: 12000 })],
      [payment({ id: 'pay1', quoteId: 'q1', amount: 3000, reference: 'INV-0208' })]
    );
    r.getByText('$3,000 paid');
    r.getByText('$12,000 to go');
    r.getByText('INV-0208');
  });

  it('corrects a payment rather than making somebody retype it', async () => {
    // A transposed invoice number must not cost the PDF attached beside it.
    const { r, onUpdatePayment } = arrange(
      [invoice({ unpaid: 12000 })],
      [payment({ id: 'pay1', quoteId: 'q1', amount: 3000, reference: 'INV-208' })]
    );
    await TestRenderer.act(async () => byLabel(r, 'INV-208, correct it').props.onPress());
    await TestRenderer.act(async () => {
      boxByLabel(r, 'Invoice number').props.onChangeText('INV-0208');
    });
    await TestRenderer.act(async () => byLabel(r, 'Save the payment').props.onPress());
    expect(onUpdatePayment).toHaveBeenCalledWith('pay1', expect.objectContaining({
      reference: 'INV-0208',
      amount: 3000,
    }));
  });

  it('loads a payment as it was typed, never the GST-inclusive figure', async () => {
    const { r } = arrange(
      [invoice()],
      [payment({ id: 'pay1', quoteId: 'q1', amount: 1000, amountInclGst: false })]
    );
    await TestRenderer.act(async () => byLabel(r, 'Payment, correct it').props.onPress());
    expect(boxByLabel(r, 'How much').props.value).toBe('1000');
  });
});

describe('an item still carrying more than one price from before', () => {
  it('shows the extras read-only, never hidden', async () => {
    const { r } = arrange([
      quote({ id: 'q1', supplier: 'Mico' }),
      quote({ id: 'q2', supplier: 'Plumbing World', amount: 900 }),
    ]);
    expect(byLabel(r, 'Correct the Mico price')).toBeDefined();
    // The second one is on the record, not a second thing you can edit here.
    expect(byLabel(r, 'Correct the Plumbing World price')).toBeUndefined();
    expect(r.root.findAllByProps({ children: 'Also on record' }).length).toBeGreaterThan(0);
  });
});

describe('installed, the one state still changed by hand', () => {
  it('is offered as a single control, separate from the price header', async () => {
    const { r, onUpdateItem } = arrange();
    expect(byLabel(r, 'Mark as installed')).toBeDefined();
    await TestRenderer.act(async () => byLabel(r, 'Mark as installed').props.onPress());
    expect(onUpdateItem).toHaveBeenCalledWith({ status: 'installed' }, 'Installed');
  });
});
