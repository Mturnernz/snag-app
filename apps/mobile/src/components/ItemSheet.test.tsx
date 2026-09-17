import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ItemSheet from './ItemSheet';

/**
 * Correcting a price already saved.
 *
 * The failure this is built against is specific: an edit box that does not hand
 * back exactly what was typed. The rollup normalises to GST-inclusive, so an
 * edit form that loaded the *normalised* figure would raise a trade price by 15%
 * every time somebody opened it to fix a typo in the supplier's name.
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
  id: 'i1', elementId: 'e1', name: 'Shower mixer', status: 'considering', sortOrder: 0,
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
  effectiveAmount: 1150, paidTotal: null,
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

function arrange(quotes: any[] = [quote()]) {
  const onUpdateQuote = jest.fn().mockResolvedValue(undefined);
  const onSetQuoteStatus = jest.fn().mockResolvedValue(undefined);
  const onAddQuote = jest.fn().mockResolvedValue(undefined);
  const r = render(
    <ItemSheet
      visible
      householdId="h"
      item={item()}
      quotes={quotes}
      onClose={jest.fn()}
      onUpdateItem={jest.fn().mockResolvedValue(undefined)}
      onDeleteItem={jest.fn().mockResolvedValue(undefined)}
      onAddQuote={onAddQuote}
      onSetQuoteStatus={onSetQuoteStatus}
      onUpdateQuote={onUpdateQuote}
      onDeleteQuote={jest.fn().mockResolvedValue(undefined)}
      onUpdateQuoteFiles={jest.fn().mockResolvedValue(undefined)}
    />
  );
  return { r, onUpdateQuote, onSetQuoteStatus, onAddQuote };
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
  // Day-first, which is what parseLooseDate reads back — the two halves of the
  // date control have to round-trip or an edit would move the date.
  expect(boxByLabel(r, 'Dated').props.value).toBe('28/08/2026');
});

it('saves the correction through updateQuote, not as a new price', async () => {
  const { r, onUpdateQuote, onAddQuote } = arrange();
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('1080'));
  await TestRenderer.act(async () => byLabel(r, 'Save the correction').props.onPress());

  expect(onAddQuote).not.toHaveBeenCalled();
  expect(onUpdateQuote).toHaveBeenCalledWith('q1', expect.objectContaining({
    amount: 1080,
    amountInclGst: false,
    supplier: 'Mico',
    kind: 'quote',
    dated: '2026-08-28',
  }));
});

it('never carries the status through a correction', async () => {
  const { r, onUpdateQuote, onSetQuoteStatus } = arrange([quote({ status: 'accepted' })]);
  await openEdit(r);
  await TestRenderer.act(async () => boxByLabel(r, 'Amount').props.onChangeText('1080'));
  await TestRenderer.act(async () => byLabel(r, 'Save the correction').props.onPress());

  // Accepting stays on set_quote_status, which is its own RPC precisely so the
  // sibling-clearing can never be skipped by a caller passing a status among
  // eight other fields. A correction is not a decision.
  expect(Object.keys(onUpdateQuote.mock.calls[0][1])).not.toContain('status');
  expect(onSetQuoteStatus).not.toHaveBeenCalled();
});

it('offers three named states where a tick could only ever say "not chosen"', async () => {
  const { r, onSetQuoteStatus } = arrange([quote({ status: 'tbc' })]);

  // "We have not decided" and "we said no" are different answers, and a tick
  // rendered them identically.
  expect(byLabel(r, 'Accepted')).toBeDefined();
  expect(byLabel(r, 'TBC')).toBeDefined();
  expect(byLabel(r, 'Declined')).toBeDefined();

  await TestRenderer.act(async () => byLabel(r, 'Declined').props.onPress());
  expect(onSetQuoteStatus).toHaveBeenCalledWith('q1', 'declined');
});

it('keeps a declined price on the record rather than dropping it', async () => {
  // What you were quoted and by whom is what makes the next renovation's
  // numbers credible. It leaves every total; it does not leave the page.
  const { r } = arrange([quote({ status: 'declined', supplier: 'Mico' })]);
  expect(byLabel(r, 'Correct the Mico price')).toBeDefined();
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

it('hides the add control while a correction is open', async () => {
  const { r } = arrange();
  await openEdit(r);
  // Two live forms would be two places the GST pill has to be got right.
  expect(byLabel(r, 'Add a quote')).toBeUndefined();
});
