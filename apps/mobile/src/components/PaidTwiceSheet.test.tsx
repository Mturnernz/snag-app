import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import PaidTwiceSheet from './PaidTwiceSheet';
import { Text } from './Text';
import type { LookAlikeContext } from './LookAlikeSheet';
import { quote } from '../test/projectFixtures';
import { Colors, Typography } from '../constants/theme';
import type { ProjectPayment } from '../types';

/**
 * A bill beside another bill that looks like its deposit. The live case:
 * Kitchen Mania's INV-15879 ($27,480.37) was paid $8,244.11 and then
 * $19,236.26, and V3, the same $8,244.11, is on Downstairs as its own paid
 * invoice. *Worth checking* used to open V3 alone.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../lib/supabase', () => ({ getFileUrl: jest.fn().mockResolvedValue('https://signed/doc') }));
jest.mock('../lib/openUrl', () => ({ openUrl: jest.fn() }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));

const bill = quote({
  id: 'inv', projectId: 'p1', supplier: 'Kitchen Mania Limited', kind: 'invoice', amount: 27480.37,
  invoiceNumber: 'INV-15879', detail: 'KITCHEN, Supply and install', paidTotal: 27480.37, unpaid: 0,
});
const twin = quote({
  id: 'v3', projectId: 'p1', supplier: 'Kitchen Mania Limited', kind: 'invoice', amount: 8244.11,
  invoiceNumber: 'V3', detail: 'New Kitchen Proposal', paidTotal: 8244.11, unpaid: 0,
});
const pay = (id: string, quoteId: string, amount: number, paidOn: string): ProjectPayment => ({
  id, quoteId, amount, amountInclGst: true, paidOn, reference: null, notes: null,
  photoPaths: [], documentPaths: [], createdAt: '',
});
const deposit = pay('a', 'inv', 8244.11, '2026-09-26');
const balance = pay('b', 'inv', 19236.26, '2026-10-20');
const v3Paid = pay('c', 'v3', 8244.11, '2026-06-12');

const context: LookAlikeContext = {
  quotes: [bill, twin],
  payments: [deposit, balance, v3Paid],
  reviews: [],
  elements: [],
  items: [],
  nameOf: () => null,
};
const echo = { bill, payment: deposit, twin };

function open(over: Partial<React.ComponentProps<typeof PaidTwiceSheet>> = {}) {
  const onDeposit = jest.fn().mockResolvedValue(undefined);
  const onTwoBills = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <PaidTwiceSheet
      visible
      echo={echo}
      context={context}
      onDeposit={onDeposit}
      onTwoBills={onTwoBills}
      onClose={onClose}
      {...over}
    />
  );
  return { r, onDeposit, onTwoBills, onClose };
}

const card = (r: ReturnType<typeof render>, id: string) => r.root.findByProps({ testID: `paid-twice-card-${id}` });
/** The app's own Text holding exactly these words, as the card styles it: bold becomes a font file further down. */
const words = (within: any, text: string) =>
  within.findAll((n: any) => n.type === Text && n.props?.children === text);
const isBold = (node: any) => flattenStyle(node.props.style).fontWeight === Typography.bold;
const payment = (within: any, label: RegExp) =>
  within.findAll((n: any) => typeof n.props?.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel))[0];
const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.label === label && n.props?.onPress && n.type !== 'Text')[0];
const press = async (node: any) => { await TestRenderer.act(async () => { await node.props.onPress(); }); };

describe('the two bills', () => {
  it('puts the bill and the one that looks like its deposit side by side', () => {
    const { r } = open();
    r.getByText('Paid twice');
    r.getByText('Kitchen Mania Limited · $8,244.11');
    expect(words(card(r, 'inv'), '$27,480.37')).toHaveLength(1);
    expect(words(card(r, 'v3'), '$8,244.11').length).toBeGreaterThan(0);
    // The bill comes first.
    const order = r.root.findAll((n: any) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('paid-twice-card-'))
      .map((n: any) => n.props.testID);
    expect(order[0]).toBe('paid-twice-card-inv');
  });

  it('lists each bill’s payments, with dates', () => {
    const { r } = open();
    expect(payment(card(r, 'inv'), /^Payment 26 Sep 2026, \$8,244\.11/)).toBeDefined();
    expect(payment(card(r, 'inv'), /^Payment 20 Oct 2026, \$19,236\.26/)).toBeDefined();
    expect(payment(card(r, 'v3'), /^Payment 12 Jun 2026, \$8,244\.11/)).toBeDefined();
  });

  it('puts the matching figure in bold: the payment on the bill, and the twin’s own figure', () => {
    const { r } = open();
    const match = payment(card(r, 'inv'), /^Payment 26 Sep 2026/);
    expect(match.props.accessibilityLabel).toMatch(/the same figure$/);
    expect(words(match, '$8,244.11').every(isBold)).toBe(true);

    const other = payment(card(r, 'inv'), /^Payment 20 Oct 2026/);
    expect(other.props.accessibilityLabel).not.toMatch(/the same figure/);
    expect(words(other, '$19,236.26').some(isBold)).toBe(false);

    // A card's own figure is always large and bold; marked, it goes from grey to ink.
    const ink = (node: any) => flattenStyle(node.props.style).color === Colors.textPrimary;
    expect(words(card(r, 'inv'), '$27,480.37').some(ink)).toBe(false);
    const twinAmount = words(card(r, 'v3'), '$8,244.11').filter((n: any) => !payment(card(r, 'v3'), /^Payment/).findAll((m: any) => m === n).length);
    expect(twinAmount).toHaveLength(1);
    expect(ink(twinAmount[0])).toBe(true);
  });

  it('offers two answers and no delete', () => {
    const { r } = open();
    expect(button(r, 'It’s the deposit')).toBeDefined();
    expect(button(r, 'Two bills')).toBeDefined();
    expect(button(r, 'Delete')).toBeUndefined();
  });
});

describe('answering', () => {
  it('puts the twin inside the bill on It’s the deposit, then closes', async () => {
    const { r, onDeposit, onTwoBills, onClose } = open();
    await press(button(r, 'It’s the deposit'));
    expect(onDeposit).toHaveBeenCalledWith(echo);
    expect(onTwoBills).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps both on Two bills, then closes', async () => {
    const { r, onDeposit, onTwoBills, onClose } = open();
    await press(button(r, 'Two bills'));
    expect(onTwoBills).toHaveBeenCalledWith(echo);
    expect(onDeposit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open with the reason when a write is refused', async () => {
    const onDeposit = jest.fn().mockRejectedValue(new Error('That contract belongs to a different job'));
    const { r, onClose } = open({ onDeposit });
    await press(button(r, 'It’s the deposit'));
    r.getByText('That contract belongs to a different job');
    expect(onClose).not.toHaveBeenCalled();
    expect(button(r, 'Two bills').props.disabled).toBe(false);
  });

  it('draws nothing without a pair', () => {
    const { r } = open({ echo: null });
    expect(r.queryByText('Paid twice')).toBeNull();
  });
});
