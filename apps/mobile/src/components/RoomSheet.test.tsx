import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import RoomSheet, { describeSupplierGroup } from './RoomSheet';
import { quote } from '../test/projectFixtures';

/**
 * One room's money — here, the whole job's.
 *
 * The rule to keep: a supplier who has sent several bills is **one heading**
 * with the bills beneath it, and the heading's figure is what those rows add
 * up to. A supplier with one price is still the one row it always was.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return { formatMoney: real.formatMoney, inclGst: real.inclGst, isUndecided: real.isUndecided };
});

const wholeJob = {
  key: 'job', name: 'Whole job', elementId: null, agreed: 0, undecided: 0, total: 0, toDecide: 0,
  supplierCount: 0, shared: 0, sharedCount: 0, setAside: null, chosen: null, settled: false,
} as any;

const msc = (over: any) => quote({
  projectId: 'p1', kind: 'invoice', supplier: 'MSC Consulting Group Ltd', detail: 'Structural Engineering',
  unpaid: 0, ...over,
});

const bills = [
  msc({ id: 'm1', dated: '2026-08-31', amount: 437, unpaid: 437 }),
  quote({ id: 'g1', projectId: 'p1', kind: 'invoice', supplier: 'Gibson Architects', amount: 2650.75, unpaid: 0 }),
  msc({ id: 'm2', dated: '2026-06-30', amount: 3565 }),
  msc({ id: 'm3', dated: '2026-07-31', amount: 333.5, supplier: 'MSC CONSULTING GROUP LTD ' }),
];

function arrange(quotes = bills, onOpenPrice = jest.fn()) {
  const r = render(
    <RoomSheet
      visible
      room={wholeJob}
      items={[]}
      quotes={quotes}
      quoteRooms={[]}
      expected={[]}
      onClose={jest.fn()}
      onOpenThing={jest.fn()}
      onOpenPrice={onOpenPrice}
      onOpenExpected={jest.fn()}
      onAdd={jest.fn()}
    />,
  );
  return r;
}

const pressable = (r: ReturnType<typeof render>, label: string) => {
  const found = r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && n.props?.onPress,
  );
  if (!found.length) throw new Error(`Nothing pressable labelled "${label}"`);
  return found[0];
};

describe('a supplier with several bills', () => {
  it('is one heading, with the bills as rows beneath it in date order', () => {
    const r = arrange();
    // Named once, however it was typed on each bill.
    r.getByText('MSC Consulting Group Ltd');
    expect(r.queryByText('MSC CONSULTING GROUP LTD')).toBeNull();
    r.getByText('3 bills · $437 to pay');
    r.getByText('$4,335.50');
    const text = r.getAllByType('Text').map((n) => n.children.join(''));
    const dates = text.filter((t) => /^\d+ \w+ 2026 · /.test(t));
    expect(dates).toEqual(['30 Jun 2026 · Paid', '31 Jul 2026 · Paid', '31 Aug 2026 · To pay']);
  });

  it('leaves a supplier with one price as the one row it was', () => {
    const r = arrange();
    r.getByText('Gibson Architects');
    r.getByText('Paid');
    r.getByText('$2,650.75');
  });

  it('opens a bill from beneath the heading', () => {
    const open = jest.fn();
    const r = arrange(bills, open);
    TestRenderer.act(() => { pressable(r, 'MSC Consulting Group Ltd, Structural Engineering, 31 Aug 2026').props.onPress(); });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('folds under its heading, keeping the heading and its figure', () => {
    const r = arrange();
    TestRenderer.act(() => { pressable(r, 'MSC Consulting Group Ltd, 3 bills · $437 to pay').props.onPress(); });
    r.getByText('MSC Consulting Group Ltd');
    r.getByText('$4,335.50');
    expect(r.queryByText('31 Aug 2026 · To pay')).toBeNull();
    TestRenderer.act(() => { pressable(r, 'MSC Consulting Group Ltd, 3 bills · $437 to pay').props.onPress(); });
    r.getByText('31 Aug 2026 · To pay');
  });
});

describe('describeSupplierGroup', () => {
  it('draws a figure only when it is the sum of the rows beneath it', () => {
    expect(describeSupplierGroup([msc({ amount: 100 }), msc({ amount: 50, unpaid: 50 })]))
      .toEqual({ subtitle: '2 bills · $50 to pay', value: '$150' });
  });

  it('says what is billed in words when a quote sits beside the bills', () => {
    const contract = quote({ supplier: 'MSC', amount: 3100, status: 'accepted' });
    expect(describeSupplierGroup([contract, msc({ amount: 437 })]))
      .toEqual({ subtitle: '1 quote · 1 bill · $437 billed · Paid', value: null });
  });

  it('draws no figure for quotes alone, which may be alternatives', () => {
    expect(describeSupplierGroup([quote({ amount: 10 }), quote({ amount: 20 })]))
      .toEqual({ subtitle: '2 quotes', value: null });
  });
});

// A bill inside another bill is listed under that bill, the way a progress
// claim is listed under its contract — never beside it, where it would read as
// a second thing owed.
describe('a bill inside another bill', () => {
  it('is left off the list, with the bill it is inside still on it', () => {
    const builder = quote({ id: 'rb', projectId: 'p1', kind: 'invoice', supplier: 'RELIABUILDER LIMITED', amount: 5587.85, unpaid: 5587.85 });
    const plumber = quote({ id: 'fp', projectId: 'p1', kind: 'invoice', supplier: 'Force Plumbing', amount: 1138.71, unpaid: 1138.71, billedThroughId: 'rb' });
    const r = arrange([builder, plumber]);
    r.getByText('RELIABUILDER LIMITED');
    expect(r.queryByText('Force Plumbing')).toBeNull();
  });
});
