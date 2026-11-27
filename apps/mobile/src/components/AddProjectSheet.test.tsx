import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AddProjectSheet from './AddProjectSheet';

/**
 * Starting a project: a name, then where it's up to, its dates and a budget.
 * No rooms step since the November 2026 reset.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true }
  )[0];

const inputByLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onChangeText,
    { deep: true }
  )[0];

function arrange(over: Partial<React.ComponentProps<typeof AddProjectSheet>> = {}) {
  const onCreate = jest.fn().mockResolvedValue(undefined);
  const r = render(
    <AddProjectSheet
      visible
      propertyId="prop"
      onCancel={jest.fn()}
      onCreate={onCreate}
      {...over}
    />
  );
  return { r, onCreate };
}

/** Name it, then move on to where it's up to. */
async function named(r: ReturnType<typeof render>) {
  await TestRenderer.act(async () => {
    inputByLabel(r, 'What are you doing?').props.onChangeText('Downstairs laundry');
  });
  await TestRenderer.act(async () => byLabel(r, 'Next').props.onPress());
}

it('asks two things, and never which rooms', async () => {
  const { r, onCreate } = arrange();
  await named(r);
  expect(r.queryByText('Which rooms does it touch?')).toBeNull();
  r.getByText('Step 2 of 2');
  await TestRenderer.act(async () => byLabel(r, 'Start it').props.onPress());
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Downstairs laundry', status: 'planned' }));
});

describe('an already-finished project', () => {
  async function toWhen(r: ReturnType<typeof render>) {
    await named(r);
    await TestRenderer.act(async () => byLabel(r, 'Already finished').props.onPress());
  }

  it('moves the start back to a finish set before it', async () => {
    const { r, onCreate } = arrange();
    await toWhen(r);
    await TestRenderer.act(async () => inputByLabel(r, 'Started').props.onChangeText('01/08/2024'));
    await TestRenderer.act(async () => inputByLabel(r, 'Finished').props.onChangeText('25/06/2024'));
    await TestRenderer.act(async () => inputByLabel(r, 'Finished').props.onBlur());
    expect(inputByLabel(r, 'Started').props.value).toBe('25/06/2024');
    r.getByText('Started moved to 25/06/2024');
    await TestRenderer.act(async () => byLabel(r, 'Start it').props.onPress());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startedOn: '2024-06-25', finishedOn: '2024-06-25' })
    );
  });

  it('moves the finish forward to a start set after it, even without leaving the box', async () => {
    const { r, onCreate } = arrange();
    await toWhen(r);
    await TestRenderer.act(async () => inputByLabel(r, 'Finished').props.onChangeText('25/06/2024'));
    await TestRenderer.act(async () => inputByLabel(r, 'Started').props.onChangeText('01/08/2024'));
    await TestRenderer.act(async () => byLabel(r, 'Start it').props.onPress());
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startedOn: '2024-08-01', finishedOn: '2024-08-01' })
    );
  });
});
