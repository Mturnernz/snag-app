import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AddProjectSheet from './AddProjectSheet';

/**
 * Starting a project, and the one thing on step two that can quietly go wrong:
 * a room made here staying here.
 *
 * Rooms are a property's vocabulary, not one sheet's. If this ever writes
 * somewhere of its own, the Projects tab and the List tab start describing two
 * different houses — which is the failure `suggestionsForRoom` already exists to
 * prevent between the House tab and the walkthrough.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const location = (name: string, i: number) => ({
  id: `l${i}`, propertyId: 'prop', name, sortOrder: i + 1,
});

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
  const onAddRoom = jest.fn().mockResolvedValue(true);
  const onCreate = jest.fn().mockResolvedValue(undefined);
  const r = render(
    <AddProjectSheet
      visible
      propertyId="prop"
      locations={['Bathroom', 'Laundry'].map(location)}
      onAddRoom={onAddRoom}
      onCancel={jest.fn()}
      onCreate={onCreate}
      {...over}
    />
  );
  return { r, onAddRoom, onCreate };
}

/** Name it, then move to step two, which is where the rooms are asked for. */
async function toRooms(r: ReturnType<typeof render>) {
  await TestRenderer.act(async () => {
    inputByLabel(r, 'What are you doing?').props.onChangeText('Downstairs laundry');
  });
  await TestRenderer.act(async () => byLabel(r, 'Next').props.onPress());
}

it('offers a way to make a room that is not on the list', async () => {
  const { r } = arrange();
  await toRooms(r);
  r.getByText('Which rooms does it touch?');
  r.getByText('+ Add a room…');
});

it('does not show a naming field until it is asked for', async () => {
  const { r } = arrange();
  await toRooms(r);
  // A box sitting open under twelve chips reads as a required field rather than
  // an escape hatch for the room the seed never guessed at.
  expect(inputByLabel(r, 'Name the room')).toBeUndefined();
});

it('writes through the shared vocabulary rather than keeping its own', async () => {
  const { r, onAddRoom } = arrange();
  await toRooms(r);
  await TestRenderer.act(async () => byLabel(r, 'Add a room').props.onPress());
  await TestRenderer.act(async () => {
    inputByLabel(r, 'Name the room').props.onChangeText('Storage area');
  });
  await TestRenderer.act(async () => byLabel(r, 'Add it').props.onPress());

  // The screen's own handler calls home.create_location and reloadLocations —
  // the same pair the House tab uses. This sheet must never write a room itself.
  expect(onAddRoom).toHaveBeenCalledWith('Storage area');
});

it('selects the new room immediately, rather than asking the question twice', async () => {
  const { r, onAddRoom, onCreate } = arrange();
  await toRooms(r);
  await TestRenderer.act(async () => byLabel(r, 'Add a room').props.onPress());
  await TestRenderer.act(async () => {
    inputByLabel(r, 'Name the room').props.onChangeText('Storage area');
  });
  await TestRenderer.act(async () => byLabel(r, 'Add it').props.onPress());
  await TestRenderer.act(async () => byLabel(r, 'Next').props.onPress());
  await TestRenderer.act(async () => byLabel(r, 'Start it').props.onPress());

  // Somebody who has typed a room into a question asking which rooms are
  // touched has answered it. It also has to reach create_project, or the
  // element named after it is never made.
  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({ rooms: ['Storage area'] })
  );
  expect(onAddRoom).toHaveBeenCalledTimes(1);
});

it('keeps the field open when the room is refused', async () => {
  const { r } = arrange({ onAddRoom: jest.fn().mockResolvedValue(false) });
  await toRooms(r);
  await TestRenderer.act(async () => byLabel(r, 'Add a room').props.onPress());
  await TestRenderer.act(async () => {
    inputByLabel(r, 'Name the room').props.onChangeText('Bathroom');
  });
  await TestRenderer.act(async () => byLabel(r, 'Add it').props.onPress());

  // The RPC refuses a duplicate in words. Closing the field on a refusal would
  // lose what was typed and say nothing about why.
  expect(inputByLabel(r, 'Name the room')).toBeDefined();
  expect(inputByLabel(r, 'Name the room').props.value).toBe('Bathroom');
});

it('still lets the step be skipped entirely', async () => {
  const { r, onCreate } = arrange();
  await toRooms(r);
  await TestRenderer.act(async () => byLabel(r, 'Skip for now').props.onPress());
  await TestRenderer.act(async () => byLabel(r, 'Start it').props.onPress());
  // No rooms is a perfectly good project: the server makes one implicit element
  // named after it and the layer is never drawn.
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ rooms: [] }));
});
