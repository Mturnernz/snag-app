import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import RoomPicker from './RoomPicker';

// *Create a new room* ends the list, so the room you are standing in is never
// a reason to leave the sheet. It makes the room and chooses it.

const settle = () => TestRenderer.act(async () => {});
const locations = [
  { id: '1', name: 'Kitchen' },
  { id: '2', name: 'Laundry' },
] as any;

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.accessibilityLabel === label && !!(n.props.onPress || n.props.onChangeText))[0];

function setup(onCreate?: (name: string) => Promise<boolean>) {
  const onChange = jest.fn();
  const r = render(<RoomPicker locations={locations} value={null} onChange={onChange} startOpen onCreate={onCreate} />);
  return { r, onChange };
}

test('offers no create row without onCreate', () => {
  const { r } = setup();
  expect(byLabel(r, 'Create a new room')).toBeUndefined();
});

test('creates a typed room and chooses it', async () => {
  const onCreate = jest.fn().mockResolvedValue(true);
  const { r, onChange } = setup(onCreate);
  TestRenderer.act(() => byLabel(r, 'Create a new room').props.onPress());
  TestRenderer.act(() => byLabel(r, 'Name the new room').props.onChangeText('Study'));
  await TestRenderer.act(async () => { byLabel(r, 'Add the room').props.onPress(); });
  await settle();
  expect(onCreate).toHaveBeenCalledWith('Study');
  expect(onChange).toHaveBeenCalledWith('Study');
});

test('a refused room is not chosen', async () => {
  const onCreate = jest.fn().mockResolvedValue(false);
  const { r, onChange } = setup(onCreate);
  TestRenderer.act(() => byLabel(r, 'Create a new room').props.onPress());
  TestRenderer.act(() => byLabel(r, 'Name the new room').props.onChangeText('Study'));
  await TestRenderer.act(async () => { byLabel(r, 'Add the room').props.onPress(); });
  await settle();
  expect(onChange).not.toHaveBeenCalled();
});

test('a room that already exists is chosen, not made twice', async () => {
  const onCreate = jest.fn().mockResolvedValue(true);
  const { r, onChange } = setup(onCreate);
  TestRenderer.act(() => byLabel(r, 'Create a new room').props.onPress());
  TestRenderer.act(() => byLabel(r, 'Name the new room').props.onChangeText('kitchen'));
  await TestRenderer.act(async () => { byLabel(r, 'Add the room').props.onPress(); });
  await settle();
  expect(onCreate).not.toHaveBeenCalled();
  expect(onChange).toHaveBeenCalledWith('Kitchen');
});
