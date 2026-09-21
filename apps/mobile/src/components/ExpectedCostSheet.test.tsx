import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ExpectedCostSheet from './ExpectedCostSheet';

/**
 * A cost somebody has been warned about, and the payments made against it.
 *
 * The rule this file exists for is the one that shipped broken: **a half-typed
 * answer in a box is still an answer.** The only thing that wrote a payment was
 * the small *Save* beside it, so filling in a value and an invoice number and
 * then pressing the sheet's own Save discarded it — silently, with nothing
 * anywhere saying so. On the live job that was every payment ever typed here:
 * `home.project_expected_cost_lines` had no rows at all.
 *
 * It is the same failure the project sheet's second step already paid for, and
 * the same fix: commit what is in the box, and hold the sheet open on a refusal
 * rather than closing over something it did not take.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const cost = (over: Partial<any> = {}): any => ({
  id: 'x1', projectId: 'p1', elementId: null, name: 'Architect',
  likelySupplier: 'Gibson', amount: 4000, amountInclGst: true,
  confirmed: false,
  settledBy: null, notes: null, createdAt: '2026-09-01T00:00:00Z', ...over,
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
  const onAddLine = jest.fn().mockResolvedValue(undefined);
  const onUpdateLine = jest.fn().mockResolvedValue(undefined);
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <ExpectedCostSheet
      visible
      elements={[]}
      showElements={false}
      existing={cost()}
      lines={[]}
      householdId="h"
      onSave={onSave}
      onConfirm={onConfirm}
      onDelete={jest.fn().mockResolvedValue(undefined)}
      onAddLine={onAddLine}
      onUpdateLine={onUpdateLine}
      onDeleteLine={jest.fn().mockResolvedValue(undefined)}
      onClose={onClose}
      {...over}
    />
  );
  return { r, onAddLine, onUpdateLine, onSave, onConfirm, onClose };
}

const startPayment = async (r: ReturnType<typeof render>) =>
  TestRenderer.act(async () => byLabel(r, 'Add a payment').props.onPress());

it('takes a payment still sitting in the box when the sheet is saved', async () => {
  const { r, onAddLine, onSave, onClose } = arrange();
  await startPayment(r);
  await TestRenderer.act(async () => {
    boxByLabel(r, 'Who it was paid to, or what for').props.onChangeText('Deposit');
    boxByLabel(r, 'Amount').props.onChangeText('1500');
    boxByLabel(r, 'Reference number').props.onChangeText('INV-0208');
  });
  await TestRenderer.act(async () => byLabel(r, 'Save').props.onPress());

  expect(onAddLine).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Deposit', amount: 1500, reference: 'INV-0208',
  }));
  expect(onSave).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('holds the sheet open, with the words still there, when it cannot take it', async () => {
  const { r, onAddLine, onSave, onClose } = arrange();
  await startPayment(r);
  await TestRenderer.act(async () => {
    boxByLabel(r, 'Amount').props.onChangeText('1500');
  });
  await TestRenderer.act(async () => byLabel(r, 'Save').props.onPress());

  expect(onAddLine).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  r.getByText('Give it a name — “Deposit”, or who it went to.');
  expect(boxByLabel(r, 'Amount').props.value).toBe('1500');
});

it('says what it wants rather than going dead', async () => {
  // A disabled button is indistinguishable from a button that did nothing, and
  // on this sheet that difference is a payment somebody typed and lost. So the
  // payment's own Save presses whatever is in the box, and answers.
  const { r, onAddLine } = arrange();
  await startPayment(r);
  await TestRenderer.act(async () => {
    boxByLabel(r, 'Amount').props.onChangeText('1500');
  });
  await TestRenderer.act(async () => byLabel(r, 'Save the payment').props.onPress());
  expect(onAddLine).not.toHaveBeenCalled();
  r.getByText('Give it a name — “Deposit”, or who it went to.');
});

it('leaves an untouched payment box alone', async () => {
  // Nothing typed is nothing to lose, so opening the form and walking past it
  // must not turn Save into a refusal.
  const { r, onAddLine, onSave, onClose } = arrange();
  await startPayment(r);
  await TestRenderer.act(async () => byLabel(r, 'Save').props.onPress());
  expect(onAddLine).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

describe('confirmed, the answer that turns a guess into a commitment', () => {
  it('is two named halves, and starts on the one every existing row already had', () => {
    // One chip that toggled would leave the other answer as the unlabelled
    // absence of a press, and here that unlabelled answer is the difference
    // between a forecast and a commitment.
    const { r } = arrange();
    expect(byLabel(r, 'Confirmed')).toBeDefined();
    expect(byLabel(r, 'Unconfirmed')).toBeDefined();
    expect(byLabel(r, 'Unconfirmed').props.accessibilityState.selected).toBe(true);
  });

  it('writes through its own call, never through Save', async () => {
    // The only write on an expected cost that changes what a total says, so it
    // cannot ride along beside a name somebody was correcting.
    const { r, onConfirm, onSave } = arrange();
    await TestRenderer.act(async () => byLabel(r, 'Confirmed').props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('writes nothing when the half already lit is pressed', async () => {
    const { r, onConfirm } = arrange();
    await TestRenderer.act(async () => byLabel(r, 'Unconfirmed').props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('answers before the network does, and puts it back when refused', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('nope'));
    const { r } = arrange({ onConfirm });
    await TestRenderer.act(async () => byLabel(r, 'Confirmed').props.onPress());
    // A control that silently keeps a state the server rejected is worse than
    // one that was slow.
    expect(byLabel(r, 'Unconfirmed').props.accessibilityState.selected).toBe(true);
  });

  it('says what each answer means, rather than only naming it', async () => {
    const { r } = arrange();
    r.getByText('It counts towards the forecast alone, and every figure that holds it says it’s a guess.');
    await TestRenderer.act(async () => byLabel(r, 'Confirmed').props.onPress());
    r.getByText('It counts as committed, and it’s still not invoiced or paid — so it sits in what’s left to be billed.');
  });

  it('carries the answer into the create rather than writing it twice', async () => {
    // A new row has no id to write against, so the answer rides in. On a row
    // that exists it has already been written by the pill, and Save must not
    // be a second writer of it.
    const { r, onSave, onConfirm } = arrange({ existing: null, lines: [] });
    await TestRenderer.act(async () => {
      boxByLabel(r, 'What the cost is for').props.onChangeText('Engineer');
    });
    await TestRenderer.act(async () => byLabel(r, 'Confirmed').props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
    await TestRenderer.act(async () => byLabel(r, 'Add it').props.onPress());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it('leaves confirmed out of Save on a row that already exists', async () => {
    const { r, onSave } = arrange();
    await TestRenderer.act(async () => byLabel(r, 'Save').props.onPress());
    expect(onSave.mock.calls[0][0].confirmed).toBeUndefined();
  });
});
