import React from 'react';
import TestRenderer from 'react-test-renderer';
import LinkAssetsSheet from './LinkAssetsSheet';
import { render, type RenderResult } from '../test/render';
import type { Location, Thing } from '../types';

jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const thing = (over: Partial<Thing> = {}): Thing => ({
  id: 't1', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'Heat pump', room: 'Bathroom', photoPaths: [], make: 'Mitsubishi',
  model: 'MSZ-AP50VGK', serial: null, consumables: [], documentPaths: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '', updatedAt: '',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

const rooms: Location[] = [
  { id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 },
  { id: 'l2', propertyId: 'p', name: 'Bathroom', sortOrder: 1 },
];

const byLabel = (r: RenderResult, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onPress
      && n.props?.accessibilityLabel === label,
    { deep: true },
  )[0];

/** A `<Button label=…>`, which names itself by prop rather than by a11y label. */
const button = (r: RenderResult, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

const field = (r: RenderResult, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
      && n.props?.accessibilityLabel === label,
    { deep: true },
  )[0];

function open(things: Thing[], linkedIds: string[] = [], room: string | null = 'Kitchen') {
  const onSave = jest.fn();
  const r = render(
    <LinkAssetsSheet
      visible
      things={things}
      linkedIds={linkedIds}
      room={room}
      locations={rooms}
      onSave={onSave}
      onCancel={jest.fn()}
    />
  );
  return { r, onSave };
}

describe('choosing what a job is about', () => {
  it('opens filtered to the job’s room, which is the best guess on the row', () => {
    const { r } = open([
      thing({ id: 'k', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: 'b', name: 'Extractor fan', room: 'Bathroom' }),
    ]);

    expect(byLabel(r, 'Dishwasher')).toBeDefined();
    expect(byLabel(r, 'Extractor fan')).toBeUndefined();
  });

  // Houses are not laid out the way a catalogue thinks — a study can hold a
  // heat pump — so the room is a filter that comes off, never a rule.
  it('offers everywhere as a way out of that filter', async () => {
    const { r } = open([
      thing({ id: 'k', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: 'b', name: 'Extractor fan', room: 'Bathroom' }),
    ]);

    await TestRenderer.act(async () => { byLabel(r, 'Everywhere').props.onPress(); });
    expect(byLabel(r, 'Extractor fan')).toBeDefined();
  });

  // Somebody typing a model number has named the thing precisely; answering
  // "not in the Kitchen" would be the filter overruling the better signal.
  it('searches the whole house, past the room filter', async () => {
    const { r } = open([
      thing({ id: 'k', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: 'b', name: 'Extractor fan', room: 'Bathroom', model: 'XF12' }),
    ]);

    await TestRenderer.act(async () => {
      field(r, 'Search assets').props.onChangeText('XF12');
    });
    expect(byLabel(r, 'Extractor fan')).toBeDefined();
    expect(byLabel(r, 'Dishwasher')).toBeUndefined();
  });

  it('checks what is already linked, and counts as you go', async () => {
    const { r } = open([thing({ id: 'k', name: 'Dishwasher', room: 'Kitchen' })], ['k']);

    expect(byLabel(r, 'Dishwasher').props.accessibilityState.checked).toBe(true);
    expect(r.queryByText('1 selected')).not.toBeNull();

    await TestRenderer.act(async () => { byLabel(r, 'Dishwasher').props.onPress(); });
    expect(r.queryByText('None selected')).not.toBeNull();
  });

  // One question — which things — so nothing reaches the row until Done. The
  // server replaces the whole set for the same reason.
  it('writes nothing until Done, and then the whole set', async () => {
    const { r, onSave } = open([
      thing({ id: 'k', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: 'k2', name: 'Rangehood', room: 'Kitchen' }),
    ], ['k']);

    await TestRenderer.act(async () => { byLabel(r, 'Rangehood').props.onPress(); });
    expect(onSave).not.toHaveBeenCalled();

    await TestRenderer.act(async () => { button(r, 'Done').props.onPress(); });
    expect(onSave).toHaveBeenCalledWith(['k', 'k2']);
  });

  it('says so rather than going blank when the record is empty', () => {
    const { r } = open([]);
    const said = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));
    expect(said.some((t: string) => t.includes('Nothing is recorded at this place yet'))).toBe(true);
  });
});
