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

  it('can be deleted, and its files go with it', async () => {
    const { r, onClose } = open();
    await press(r, 'Delete bill');
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
