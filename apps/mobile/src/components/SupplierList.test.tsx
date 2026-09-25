import React from 'react';
import TestRenderer from 'react-test-renderer';
import { PanResponder, type PanResponderCallbacks } from 'react-native';
import { render, type RenderResult } from '../test/render';
import SupplierList, { dropTarget } from './SupplierList';
import type { SupplierEntry } from '@snag/supabase-queries';

/**
 * Press and hold a supplier, drop it on another, and the page is asked to merge
 * them. Nothing is written here: the page confirms first. No test drives a
 * PanResponder through touch history, so the responder's own callbacks are
 * captured and called with the gesture state a real drag would give them.
 */

let pan: PanResponderCallbacks;
beforeEach(() => {
  // The row springs back on an Animated timing; run it here rather than after
  // the environment has gone.
  jest.useFakeTimers();
  const create = PanResponder.create.bind(PanResponder);
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
    pan = config;
    return create(config);
  });
});
afterEach(() => {
  TestRenderer.act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const entry = (over: Partial<SupplierEntry>): SupplierEntry => ({
  key: 'x', name: 'X', prices: 1, expectedCosts: 0, paid: 0, files: 0, sameAs: [], mergeInto: null, ...over,
});
const relia = entry({ key: 'reliabuilder', name: 'ReliaBuilder', prices: 4 });
const shouting = entry({
  key: 'reliabuilder limited', name: 'RELIABUILDER LIMITED', sameAs: ['reliabuilder'], mergeInto: 'reliabuilder',
});
const tiles = entry({ key: 'tile depot', name: 'Tile Depot' });
const money = (n: number) => `$${n}`;

/** The row's own Pressable — the composite, which carries onPress and onLongPress. */
const rowFor = (r: RenderResult, name: string) =>
  r.root.findAll((n) => n.props.onLongPress && String(n.props.accessibilityLabel).startsWith(`${name},`), { deep: true })[0]
  ?? r.root.findAll((n) => n.props.onLongPress && n.props.accessibilityLabel === name, { deep: true })[0];

function arrange(list: SupplierEntry[] = [relia, shouting, tiles]) {
  const onOpen = jest.fn();
  const onMerge = jest.fn();
  const onDragChange = jest.fn();
  const r = render(
    <SupplierList suppliers={list} money={money} onOpen={onOpen} onMerge={onMerge} onDragChange={onDragChange} />,
  );
  // Rows 60pt tall, stacked: 0–60, 60–120, 120–180.
  const laid = r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function', { deep: true });
  TestRenderer.act(() => {
    list.forEach((_s, i) => laid[i].props.onLayout({ nativeEvent: { layout: { x: 0, y: i * 60, width: 340, height: 60 } } }));
  });
  return { r, onOpen, onMerge, onDragChange };
}

const move = (dy: number) => TestRenderer.act(() => {
  pan.onPanResponderMove!({} as any, { dy } as any);
});
const release = () => TestRenderer.act(() => { pan.onPanResponderRelease!({} as any, {} as any); });

describe('dropTarget', () => {
  const bands = [
    { key: 'a', top: 0, bottom: 60 },
    { key: 'b', top: 60, bottom: 120 },
  ];

  it('is the row under the point', () => {
    expect(dropTarget(bands, 30, 'b')).toBe('a');
    expect(dropTarget(bands, 60, 'a')).toBe('b');
  });

  it('is nowhere over its own row, or outside the list', () => {
    expect(dropTarget(bands, 90, 'b')).toBeNull();
    expect(dropTarget(bands, -5, 'b')).toBeNull();
    expect(dropTarget(bands, 120, 'a')).toBeNull();
  });
});

describe('press, hold and drop', () => {
  it('lets the page scroll until a row has been held', () => {
    arrange();
    expect(pan.onMoveShouldSetPanResponderCapture!({} as any, {} as any)).toBe(false);
  });

  it('lifts the row on a long press and stops the page scrolling', () => {
    const { r, onDragChange } = arrange();
    TestRenderer.act(() => rowFor(r, 'RELIABUILDER LIMITED').props.onLongPress());
    expect(onDragChange).toHaveBeenCalledWith(true);
    // From here every move is the list's, which ends the row's own press.
    expect(pan.onMoveShouldSetPanResponderCapture!({} as any, {} as any)).toBe(true);
  });

  it('says where it will land, then asks to merge into the row it was dropped on', () => {
    const { r, onMerge, onDragChange } = arrange();
    TestRenderer.act(() => rowFor(r, 'RELIABUILDER LIMITED').props.onLongPress());
    move(-60);
    r.getByText('Drop to merge into ReliaBuilder');
    release();
    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onMerge).toHaveBeenCalledWith(shouting, relia);
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the element under the finger mounted, changing only its words', () => {
    // A touch belongs to the element it started on. Swap that element out
    // mid-drag and the browser never delivers the lift: the drop is lost on a
    // phone while a mouse, hit-tested afresh, still works.
    const { r } = arrange();
    const [facts] = r.getAllByText('1 price');
    const texts = r.getAllByType('Text').length;
    TestRenderer.act(() => rowFor(r, 'RELIABUILDER LIMITED').props.onLongPress());
    move(-60);
    expect(r.getAllByType('Text')).toHaveLength(texts);
    expect(facts.children.join('')).toBe('Drop to merge into ReliaBuilder');
  });

  it('merges any two suppliers, not only the ones that look alike', () => {
    const { r, onMerge } = arrange();
    TestRenderer.act(() => rowFor(r, 'Tile Depot').props.onLongPress());
    move(-120);
    release();
    expect(onMerge).toHaveBeenCalledWith(tiles, relia);
  });

  it('puts the row back and asks nothing when it is let go over itself', () => {
    const { r, onMerge, onDragChange } = arrange();
    TestRenderer.act(() => rowFor(r, 'Tile Depot').props.onLongPress());
    move(10);
    release();
    expect(onMerge).not.toHaveBeenCalled();
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it('puts the row back when it is dragged off the list', () => {
    const { r, onMerge } = arrange();
    TestRenderer.act(() => rowFor(r, 'ReliaBuilder').props.onLongPress());
    move(400);
    release();
    expect(onMerge).not.toHaveBeenCalled();
  });

  it('asks nothing when the gesture is taken away mid-drag', () => {
    const { r, onMerge, onDragChange } = arrange();
    TestRenderer.act(() => rowFor(r, 'RELIABUILDER LIMITED').props.onLongPress());
    move(-60);
    TestRenderer.act(() => { pan.onPanResponderTerminate!({} as any, {} as any); });
    expect(onMerge).not.toHaveBeenCalled();
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });
});

describe('the other ways in', () => {
  it('opens the supplier on a plain tap', () => {
    const { r, onOpen, onMerge } = arrange();
    TestRenderer.act(() => rowFor(r, 'Tile Depot').props.onPress());
    expect(onOpen).toHaveBeenCalledWith(tiles);
    expect(onMerge).not.toHaveBeenCalled();
  });

  it('says how to merge only on a name that looks like another, and offers the one-tap Merge there', () => {
    const { r, onMerge } = arrange();
    r.getByText('Looks like ReliaBuilder · hold and drop onto it to merge');
    expect(r.getAllByText('Merge')).toHaveLength(1);
    const pill = r.root.findAll((n) => n.props.accessibilityLabel === 'Merge RELIABUILDER LIMITED into ReliaBuilder' && n.props.onPress, { deep: true })[0];
    TestRenderer.act(() => pill.props.onPress());
    expect(onMerge).toHaveBeenCalledWith(shouting, relia);
  });

  it('offers the merge as an accessibility action, which opens the supplier’s sheet', () => {
    const { r, onOpen } = arrange();
    const row = rowFor(r, 'Tile Depot');
    expect(row.props.accessibilityActions).toEqual([{ name: 'merge', label: 'Merge into another supplier' }]);
    TestRenderer.act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'merge' } }));
    expect(onOpen).toHaveBeenCalledWith(tiles);
  });
});
