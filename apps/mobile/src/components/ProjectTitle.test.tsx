import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import ProjectTitle from './ProjectTitle';

/**
 * A project's name, renamed where it stands. A box writes when it is left, an
 * unchanged or emptied one writes nothing, and leaving the page writes what is
 * still in it.
 */

let mockListeners: Record<string, () => void> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    addListener: (event: string, fn: () => void) => {
      mockListeners[event] = fn;
      return () => { delete mockListeners[event]; };
    },
  }),
}));

beforeEach(() => { mockListeners = {}; });

const box = (r: RenderResult) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Project name', { deep: true })[0];

function arrange(onRename = jest.fn().mockResolvedValue(undefined)) {
  const r = render(<ProjectTitle name="Roof" onRename={onRename} />);
  const edit = () => TestRenderer.act(() => {
    r.root.findAll((n) => n.props.accessibilityLabel === 'Roof. Rename this project' && n.props.onPress, { deep: true })[0]
      .props.onPress();
  });
  return { r, onRename, edit };
}

it('shows the name as the page heading, with a way to rename it', () => {
  const { r } = arrange();
  r.getByText('Roof');
  expect(box(r)).toBeUndefined();
});

it('turns into a box holding the name when pressed', () => {
  const { r, edit } = arrange();
  edit();
  expect(box(r).props.value).toBe('Roof');
  expect(box(r).props.maxLength).toBe(80);
});

it('writes the new name, trimmed, when the box is left', async () => {
  const { r, onRename, edit } = arrange();
  edit();
  TestRenderer.act(() => box(r).props.onChangeText('  Roof and gutters '));
  await TestRenderer.act(async () => { box(r).props.onBlur(); });
  expect(onRename).toHaveBeenCalledTimes(1);
  expect(onRename).toHaveBeenCalledWith('Roof and gutters');
  expect(box(r)).toBeUndefined();
});

it('writes once when Return and the blur after it both arrive', async () => {
  const { r, onRename, edit } = arrange();
  edit();
  TestRenderer.act(() => box(r).props.onChangeText('Roof and gutters'));
  const input = box(r);
  await TestRenderer.act(async () => {
    input.props.onSubmitEditing();
    input.props.onBlur();
  });
  expect(onRename).toHaveBeenCalledTimes(1);
});

it('writes nothing for a name that has not changed', async () => {
  const { r, onRename, edit } = arrange();
  edit();
  await TestRenderer.act(async () => { box(r).props.onBlur(); });
  expect(onRename).not.toHaveBeenCalled();
});

it('puts the old name back when the box is emptied', async () => {
  const { r, onRename, edit } = arrange();
  edit();
  TestRenderer.act(() => box(r).props.onChangeText('   '));
  await TestRenderer.act(async () => { box(r).props.onBlur(); });
  expect(onRename).not.toHaveBeenCalled();
  r.getByText('Roof');
});

it('writes what is still in the box when the page is left', async () => {
  const { r, onRename, edit } = arrange();
  edit();
  TestRenderer.act(() => box(r).props.onChangeText('Roof and gutters'));
  await TestRenderer.act(async () => { mockListeners.beforeRemove(); });
  expect(onRename).toHaveBeenCalledWith('Roof and gutters');
});

it('keeps the box open with the words in it when the write is refused', async () => {
  const { r, edit } = arrange(jest.fn().mockRejectedValue(new Error('Keep the name to 80 characters or fewer')));
  edit();
  TestRenderer.act(() => box(r).props.onChangeText('Roof and gutters'));
  await TestRenderer.act(async () => { box(r).props.onBlur(); });
  expect(box(r).props.value).toBe('Roof and gutters');
  r.getByText('Keep the name to 80 characters or fewer');
});
