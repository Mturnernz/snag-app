import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import PaintAreaSheet from './PaintAreaSheet';

/**
 * Where a paint went: a place picked is written at once, a place typed needs
 * its button, and a place the paint already went is never offered twice.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const tap = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];
const box = (r: RenderResult) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Somewhere else' && 'onChangeText' in n.props, { deep: true })[0];
const texts = (r: RenderResult) =>
  r.getAllByType('Text').map((n: any) => (n.children ?? []).filter((c: unknown) => typeof c === 'string').join(''));

function open(editing: string | null, areas: string[]) {
  const onChoose = jest.fn();
  const onRemove = jest.fn();
  const onClose = jest.fn();
  const r = render(
    <PaintAreaSheet visible editing={editing} areas={areas} onChoose={onChoose} onRemove={onRemove} onClose={onClose} />
  );
  return { r, onChoose, onRemove, onClose };
}

describe('PaintAreaSheet', () => {
  it('chooses a place with one tap', () => {
    const { r, onChoose } = open(null, ['Main wall']);
    TestRenderer.act(() => tap(r, 'Architraves').props.onPress());
    expect(onChoose).toHaveBeenCalledWith('Architraves');
  });

  it('never offers a place the paint already went', () => {
    const { r, onChoose } = open(null, ['Main wall', 'ceiling']);
    // Any capitals: "ceiling" typed into the walkthrough is the Ceiling chip.
    expect(tap(r, 'Ceiling').props.disabled).toBe(true);
    expect(tap(r, 'Main wall').props.disabled).toBe(true);
    TestRenderer.act(() => tap(r, 'Ceiling').props.onPress());
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('leaves the place being changed live, and pressing it again changes nothing', () => {
    const { r, onChoose, onClose } = open('Ceiling', ['Main wall', 'Ceiling']);
    expect(tap(r, 'Ceiling').props.disabled).toBe(false);
    expect(tap(r, 'Main wall').props.disabled).toBe(true);
    TestRenderer.act(() => tap(r, 'Ceiling').props.onPress());
    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a typed place with its button, capitalised', () => {
    const { r, onChoose } = open(null, ['Main wall']);
    TestRenderer.act(() => box(r).props.onChangeText('stair balustrade'));
    expect(onChoose).not.toHaveBeenCalled();
    TestRenderer.act(() => tap(r, 'Add').props.onPress());
    expect(onChoose).toHaveBeenCalledWith('Stair balustrade');
  });

  it('says what it wants rather than adding nothing, or a place twice', () => {
    const { r, onChoose } = open(null, ['Main wall']);
    TestRenderer.act(() => tap(r, 'Add').props.onPress());
    expect(texts(r)).toContain('Type where it went, or pick one above.');

    TestRenderer.act(() => box(r).props.onChangeText('main wall'));
    TestRenderer.act(() => tap(r, 'Add').props.onPress());
    expect(texts(r)).toContain('main wall is already on this paint.');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('opens a typed place in the box to correct, and offers to remove it', () => {
    const { r, onChoose, onRemove } = open('Stair balustrade', ['Main wall', 'Stair balustrade']);
    expect(box(r).props.value).toBe('Stair balustrade');
    TestRenderer.act(() => box(r).props.onChangeText('Stair rail'));
    TestRenderer.act(() => tap(r, 'Save').props.onPress());
    expect(onChoose).toHaveBeenCalledWith('Stair rail');

    TestRenderer.act(() => tap(r, 'Remove Stair balustrade').props.onPress());
    expect(onRemove).toHaveBeenCalled();
  });

  it('has nothing to remove while adding', () => {
    const { r } = open(null, ['Main wall']);
    expect(texts(r).some((t) => t.startsWith('Remove'))).toBe(false);
  });
});
