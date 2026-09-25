import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import SupplierSheet from './SupplierSheet';
import type { SupplierEntry } from '@snag/supabase-queries';

/**
 * One supplier: rename them across the job, or merge them into another name
 * on it. A rename writes once; a merge never writes here at all — the page
 * confirms it first.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const entry = (over: Partial<SupplierEntry>): SupplierEntry => ({
  key: 'x', name: 'X', prices: 1, expectedCosts: 0, paid: 0, files: 0, sameAs: [], mergeInto: null, ...over,
});
const relia = entry({ key: 'reliabuilder', name: 'ReliaBuilder', prices: 4 });
const shouting = entry({ key: 'reliabuilder limited', name: 'RELIABUILDER LIMITED', mergeInto: 'reliabuilder' });
const tiles = entry({ key: 'tile depot', name: 'Tile Depot' });

const tap = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];
const box = (r: RenderResult) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'What they’re called' && 'onChangeText' in n.props, { deep: true })[0];

function open(supplier: SupplierEntry = shouting) {
  const onRename = jest.fn().mockResolvedValue(undefined);
  const onMerge = jest.fn();
  const onClose = jest.fn();
  const r = render(
    <SupplierSheet
      supplier={supplier}
      all={[relia, shouting, tiles]}
      money={(n) => `$${n}`}
      onRename={onRename}
      onMerge={onMerge}
      onClose={onClose}
    />,
  );
  return { r, onRename, onMerge, onClose };
}

it('renames across the job in one write, with the name as typed', async () => {
  const { r, onRename, onMerge, onClose } = open();
  TestRenderer.act(() => box(r).props.onChangeText('Relia Builders NZ '));
  await TestRenderer.act(async () => { tap(r, 'Save').props.onPress(); });
  expect(onRename).toHaveBeenCalledTimes(1);
  expect(onRename).toHaveBeenCalledWith(shouting, 'Relia Builders NZ');
  expect(onMerge).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('turns a name another supplier already has into a merge, and says so before anything is written', async () => {
  const { r, onRename, onMerge } = open();
  TestRenderer.act(() => box(r).props.onChangeText('reliabuilder'));
  r.getByText('ReliaBuilder is already on this job. Saving combines the two.');
  await TestRenderer.act(async () => { tap(r, 'Merge').props.onPress(); });
  expect(onMerge).toHaveBeenCalledWith(shouting, relia);
  expect(onRename).not.toHaveBeenCalled();
});

it('closes without writing when the name is unchanged', async () => {
  const { r, onRename, onClose } = open();
  await TestRenderer.act(async () => { tap(r, 'Save').props.onPress(); });
  expect(onRename).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('refuses an empty name in words, and stays open', async () => {
  const { r, onRename, onClose } = open();
  TestRenderer.act(() => box(r).props.onChangeText('   '));
  await TestRenderer.act(async () => { tap(r, 'Save').props.onPress(); });
  r.getByText('What should they be called?');
  expect(onRename).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps the sheet open with the server’s words when the rename is refused', async () => {
  const { r, onRename, onClose } = open();
  onRename.mockRejectedValueOnce(new Error('That name is too long — 80 characters at most.'));
  TestRenderer.act(() => box(r).props.onChangeText('A new name'));
  await TestRenderer.act(async () => { tap(r, 'Save').props.onPress(); });
  r.getByText('That name is too long — 80 characters at most.');
  expect(onClose).not.toHaveBeenCalled();
});

it('lists every other supplier to merge into, the look-alikes first', () => {
  const { r, onMerge } = open();
  const names = r.root
    .findAll((n) => n.props.accessibilityLabel?.startsWith?.('Merge RELIABUILDER LIMITED into ') && n.props.onPress, { deep: true })
    .map((n) => n.props.accessibilityLabel);
  expect([...new Set(names)]).toEqual([
    'Merge RELIABUILDER LIMITED into ReliaBuilder',
    'Merge RELIABUILDER LIMITED into Tile Depot',
  ]);
  r.getByText('Looks like the same business');
  TestRenderer.act(() => tap(r, 'Merge RELIABUILDER LIMITED into Tile Depot').props.onPress());
  expect(onMerge).toHaveBeenCalledWith(shouting, tiles);
});
