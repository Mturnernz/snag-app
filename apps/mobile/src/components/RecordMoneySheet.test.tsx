import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import RecordMoneySheet from './RecordMoneySheet';

/**
 * Recording money, one question at a time.
 *
 * The rules that would erode first, in the order they would go: a claim being
 * asked what scope it is against (it inherits its contract's, and that is what
 * keeps a contract and its claims out of Committed twice); a step appearing
 * when it has nothing to offer; and a bill being allowed to invent a part,
 * which is how "Whole job" and then "Builders Quote" got made.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const quote = (over: Partial<any> = {}): any => ({
  id: 'q1', itemId: null, elementId: null, projectId: 'p1',
  supplier: 'ReliaBuilder', detail: 'Main contract',
  amount: 176755, amountInclGst: true, kind: 'quote', status: 'accepted', basis: 'fixed',
  dated: null, notes: null, supersedesLineId: null, photoPaths: [], documentPaths: [],
  dueOn: null, billedThroughId: null, settlesMilestoneId: null, againstQuoteId: null,
  createdAt: '2026-03-10T00:00:00Z',
  amountIncl: 176755, lineCount: 0, linesTotal: null, buildUp: null,
  allowanceOpen: 0, additionalOpen: 0, effectiveAmount: 176755,
  paidTotal: null, unpaid: null, claimedTotal: null, ...over,
});

const element = (over: Partial<any> = {}): any => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs Bathroom', room: 'Bathroom',
  implicit: false, sortOrder: 0, notes: null, budget: null, budgetInclGst: true,
  expectedOpen: 0, expectedCount: 0, expectedConfirmed: null, budgetGap: 0,
  committedDerived: null, invoicedDerived: null, paidDerived: null,
  committedOverride: null, invoicedOverride: null, paidOverride: null,
  committedNote: null, invoicedNote: null, paidNote: null,
  committedTotal: null, invoicedTotal: null, paidTotal: null,
  allowanceOpen: 0, additionalOpen: 0, itemCount: 0, pricedCount: 0, quotedCount: 0,
  photoPaths: [], documentPaths: [], createdAt: '', ...over,
});

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

const boxByLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

function arrange(over: Partial<any> = {}) {
  const onFinish = jest.fn().mockResolvedValue(undefined);
  const r = render(
    <RecordMoneySheet
      visible
      projectId="p1"
      householdId="h"
      elements={[element()]}
      items={[]}
      quotes={[quote()]}
      expected={[]}
      milestones={[]}
      knownSuppliers={[]}
      showElements
      onFinish={onFinish}
      onClose={jest.fn()}
      {...over}
    />
  );
  return { r, onFinish };
}

const press = (r: ReturnType<typeof render>, label: string) =>
  TestRenderer.act(async () => byLabel(r, label).props.onPress());

it('asks who it is from first, and says what you already have from them', async () => {
  // The one thing you know without reading the document, and the key that lets
  // every later step narrow itself.
  const { r } = arrange();
  r.getByText('Who’s it from?');
  r.getByText('ReliaBuilder');
  r.getByText('signed contract');
});

it('offers a claim against the contract, with what is left to claim', async () => {
  const { r } = arrange({ quotes: [quote({ claimedTotal: 87975 })] });
  await press(r, 'ReliaBuilder');
  r.getByText('A claim against the contract');
  r.getByText('Main contract — $87,975 claimed of $176,755 — $88,780 still to claim');
});

it('never asks a claim what it is against — it inherits the contract’s scope', async () => {
  // The whole double-count fix, made invisible rather than explained. The
  // contract sits on the job, so the claim does too, and `create_quote`
  // refuses anything else.
  const { r, onFinish } = arrange();
  await press(r, 'ReliaBuilder');
  await press(r, 'A claim against the contract');
  await TestRenderer.act(async () => {
    boxByLabel(r, 'Amount').props.onChangeText('43987.50');
    boxByLabel(r, 'Invoice number').props.onChangeText('INV-0231');
    boxByLabel(r, "What it's for").props.onChangeText('claim 3, linings');
  });
  await press(r, 'Next');
  expect(r.queryByText('What’s it against?')).toBeNull();
  await press(r, 'Record it');

  const plan = onFinish.mock.calls[0][0];
  expect(plan.kind).toBe('claim');
  expect(plan.quote.againstQuoteId).toBe('q1');
  expect(plan.quote.projectId).toBe('p1');
  expect(plan.quote.itemId).toBeNull();
  expect(plan.quote.elementId).toBeNull();
  expect(plan.quote.kind).toBe('invoice');
  expect(plan.quote.detail).toBe('INV-0231 — claim 3, linings');
});

it('is three steps for a claim and more for a contract', async () => {
  const { r } = arrange();
  await press(r, 'ReliaBuilder');
  await press(r, 'A claim against the contract');
  // who · what · details — the frequent thing stays short.
  r.getByText('Step 3 of 4 · ReliaBuilder');
});

it('asks a quote whether it is signed, and whether the number can move', async () => {
  // The one field whose absence left a $176,755 contract out of Committed for
  // five months, asked where the person definitely knows the answer.
  const { r } = arrange({ quotes: [] });
  await TestRenderer.act(async () => boxByLabel(r, "Search who it's from").props.onChangeText('Gib'));
  await press(r, 'Add "Gib"');
  await press(r, 'A quote');
  r.getByText('HAVE YOU SIGNED IT?');
  r.getByText('CAN THIS NUMBER MOVE?');
});

it('lets a quote name a category the job did not have, and never lets a bill', async () => {
  // A quote is a planning moment; a bill records money against a job somebody
  // has already described. A bill that can invent a bucket is how "Whole job"
  // came back twice.
  const { r } = arrange({ quotes: [] });
  await TestRenderer.act(async () => boxByLabel(r, "Search who it's from").props.onChangeText('MSC'));
  await press(r, 'Add "MSC"');
  await press(r, 'A quote');
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('4335.50'));
  await press(r, 'Next');
  await press(r, 'A part of it');
  expect(boxByLabel(r, 'Name a new category')).toBeDefined();
});

it('does not ask what it replaces when there is nothing to replace', async () => {
  const { r } = arrange({ quotes: [] });
  await TestRenderer.act(async () => boxByLabel(r, "Search who it's from").props.onChangeText('New'));
  await press(r, 'Add "New"');
  await press(r, 'A bill');
  expect(r.queryByText('Does this replace something?')).toBeNull();
});

it('routes a cost to expect to the forecast rather than to a price', async () => {
  const { r, onFinish } = arrange({ quotes: [] });
  await TestRenderer.act(async () => boxByLabel(r, "Search who it's from").props.onChangeText('Gibson'));
  await press(r, 'Add "Gibson"');
  await press(r, 'A cost to expect');
  await TestRenderer.act(async () =>
    boxByLabel(r, 'What the cost is for').props.onChangeText('Engineer'));
  await press(r, 'Next');
  await press(r, 'Record it');

  const plan = onFinish.mock.calls[0][0];
  expect(plan.kind).toBe('expected');
  expect(plan.quote).toBeNull();
  expect(plan.expected).toEqual(expect.objectContaining({
    name: 'Engineer', likelySupplier: 'Gibson', confirmed: false,
  }));
});

it('writes nothing until the last step', async () => {
  // A half-created invoice is a wrong number in a total, not merely a thin
  // record — the thing walkthrough's rule, with more force.
  const { r, onFinish } = arrange();
  await press(r, 'ReliaBuilder');
  await press(r, 'A claim against the contract');
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('43987.50'));
  await press(r, 'Next');
  expect(onFinish).not.toHaveBeenCalled();
});
